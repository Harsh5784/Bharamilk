<<<<<<< HEAD
const express = require('express');
const mysql = require('mysql2/promise'); // Changed to promise version
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 9584;

// Middleware
app.use('/api', express.Router());
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// MySQL Connection Pool (using promise-based connection)
const pool = mysql.createPool({
  host: 'c012ftp.cloudclusters.net',
  user: '	admin',
  password: '	6mYAkdNO2Amm',
  database: 'BharatDairy',
  port: 61102,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Verify connection
const verifyConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to the remote MySQL database');
    connection.release();
  } catch (err) {
    console.error('❌ Error connecting to the database:', err.message);
    process.exit(1);
  }
};

verifyConnection();

// Middleware for verifying JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(403).json({ message: 'Authorization required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'defaultsecret', (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
};

// Customer Login API
app.post('/login', async (req, res) => {
  const { customerId, password } = req.body;

  if (!customerId || !password) {
    return res.status(400).json({ message: 'Customer ID and password are required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM customers WHERE customer_id = ?', [customerId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer ID not found' });
    }

    const user = rows[0];
    if (password !== user.password) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { customerId: user.customer_id, name: user.name, role: 'customer' },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '1h' }
    );

    return res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    console.error('❌ Error during login:', err.message);
    return res.status(500).json({ message: 'Database error' });
  }
});
// Fetch orders for a specific customer with proper date formatting
app.get('/orders/:customerId', verifyToken, async (req, res) => {
  const { customerId } = req.params;

  try {
    // Enhanced query to get all order details with proper date formatting
    const query = `
      SELECT 
        o.order_id,
        o.customer_id,
        o.quantity,
        o.price,
        o.paid_amount,
        o.payment_status,
        DATE_FORMAT(o.order_date, '%Y-%m-%d') as order_date,
        (o.quantity * o.price) as total_amount
      FROM orders o
      WHERE o.customer_id = ?
      ORDER BY o.order_date DESC
    `;

    const [rows] = await pool.query(query, [customerId]);

    // Format the response to match Flutter app expectations
    res.json({
      success: true,
      orders: rows.map(order => ({
        order_id: order.order_id,
        customer_id: order.customer_id,
        quantity: Number(order.quantity),
        price: Number(order.price),
        paid_amount: Number(order.paid_amount || 0),
        payment_status: order.payment_status,
        order_date: order.order_date,
        total_amount: Number(order.total_amount)
      }))
    });

  } catch (error) {
    console.error('Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});
// Admin Login API
app.post('/adminlogin', async (req, res) => {
  const { adminId, password } = req.body;

  if (!adminId || !password) {
    return res.status(400).json({ message: 'Admin email and password are required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [adminId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const admin = rows[0];
    if (password !== admin.password) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { adminId: admin.id, name: admin.name, role: 'admin' },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '1h' }
    );

    return res.status(200).json({ message: 'Admin Login successful', token });
  } catch (err) {
    console.error('❌ Error during admin login:', err.message);
    return res.status(500).json({ message: 'Database error' });
  }
});

// Create new order for daily entry
app.post('/daily-entry', verifyToken, async (req, res) => {
  const entries = req.body.entries; // Array of daily entries
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    for (const entry of entries) {
      const { customer_id, quantity, price, supplied } = entry;
      
      if (supplied) {
        const query = `
          INSERT INTO orders (customer_id, quantity, price, order_date, payment_status)
          VALUES (?, ?, ?, NOW(), 'Pending')
        `;
        
        await connection.query(query, [customer_id, quantity, price]);
      }
    }
    
    await connection.commit();
    res.status(200).json({ message: 'Daily entries recorded successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error recording daily entries:', error);
    res.status(500).json({ message: 'Failed to record daily entries' });
  } finally {
    connection.release();
  }
});

// Add this to your existing server.js
// Modify existing payment
app.put('/admin/modify-payment/:paymentId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { paymentId } = req.params;
    const { amount_paid, payment_date, customer_id } = req.body;

    // Get original payment details
    const [originalPayment] = await connection.query(
      'SELECT amount_paid, payment_date, customer_id FROM payments WHERE payment_id = ?',
      [paymentId]
    );

    if (originalPayment.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const original = originalPayment[0];

    // If amount is being modified, we need to recalculate everything
    if (original.amount_paid !== amount_paid) {
      // First, reverse the original payment's effects
      // 1. Get current advance
      const [advanceRows] = await connection.query(
        'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
        [original.customer_id]
      );
      
      let currentAdvance = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
      
      // 2. Revert all order payments after this payment date
      const [affectedOrders] = await connection.query(
        `SELECT order_id, quantity, price, paid_amount, payment_status 
         FROM orders 
         WHERE customer_id = ? 
         AND order_date >= ?
         AND payment_status IN ('Paid', 'Partially Paid')
         ORDER BY order_date ASC`,
        [original.customer_id, original.payment_date]
      );

      // Reset affected orders to pending
      for (const order of affectedOrders) {
        await connection.query(
          'UPDATE orders SET payment_status = ?, paid_amount = 0 WHERE order_id = ?',
          ['Pending', order.order_id]
        );
      }

      // 3. Apply the new payment amount
      let availableMoney = Number(amount_paid);
      
      // Process each order with new amount
      for (const order of affectedOrders) {
        const orderTotal = Number(order.quantity) * Number(order.price);
        
        if (availableMoney >= orderTotal) {
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
            ['Paid', orderTotal, order.order_id]
          );
          availableMoney -= orderTotal;
        } else if (availableMoney > 0) {
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
            ['Partially Paid', availableMoney, order.order_id]
          );
          availableMoney = 0;
        }
      }

      // Update advance amount if there's money left
      if (availableMoney > 0) {
        if (advanceRows.length > 0) {
          await connection.query(
            'UPDATE customer_advances SET advance_amount = ? WHERE customer_id = ?',
            [availableMoney, original.customer_id]
          );
        } else {
          await connection.query(
            'INSERT INTO customer_advances (customer_id, advance_amount) VALUES (?, ?)',
            [original.customer_id, availableMoney]
          );
        }
      }
    }

    // Update the payment record
    await connection.query(
      'UPDATE payments SET amount_paid = ?, payment_date = ? WHERE payment_id = ?',
      [amount_paid, payment_date, paymentId]
    );

    await connection.commit();
    
    res.json({
      success: true,
      message: 'Payment modified successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error modifying payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to modify payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// Modify daily entry
app.put('/admin/modify-daily-entry/:orderId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { orderId } = req.params;
    const { quantity, price, order_date } = req.body;

    // Get original order details
    const [originalOrder] = await connection.query(
      'SELECT customer_id, quantity, price, paid_amount, payment_status FROM orders WHERE order_id = ?',
      [orderId]
    );

    if (originalOrder.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const original = originalOrder[0];
    const newTotal = quantity * price;
    const originalTotal = original.quantity * original.price;

    // If the order was partially or fully paid, we need to handle the payment adjustment
    if (original.payment_status !== 'Pending') {
      const paidRatio = original.paid_amount / originalTotal;
      const newPaidAmount = Math.min(newTotal, paidRatio * newTotal);
      
      // Update order with new quantity, price and adjusted paid amount
      await connection.query(
        `UPDATE orders 
         SET quantity = ?, 
             price = ?, 
             paid_amount = ?,
             payment_status = ?,
             order_date = ?
         WHERE order_id = ?`,
        [
          quantity, 
          price, 
          newPaidAmount,
          newPaidAmount === newTotal ? 'Paid' : 'Partially Paid',
          order_date,
          orderId
        ]
      );

      // If the paid amount decreased, add the difference to customer's advance
      if (original.paid_amount > newPaidAmount) {
        const advanceDifference = original.paid_amount - newPaidAmount;
        
        const [advanceRows] = await connection.query(
          'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
          [original.customer_id]
        );

        if (advanceRows.length > 0) {
          await connection.query(
            'UPDATE customer_advances SET advance_amount = advance_amount + ? WHERE customer_id = ?',
            [advanceDifference, original.customer_id]
          );
        } else {
          await connection.query(
            'INSERT INTO customer_advances (customer_id, advance_amount) VALUES (?, ?)',
            [original.customer_id, advanceDifference]
          );
        }
      }
    } else {
      // If order was pending, simply update the values
      await connection.query(
        'UPDATE orders SET quantity = ?, price = ?, order_date = ? WHERE order_id = ?',
        [quantity, price, order_date, orderId]
      );
    }

    await connection.commit();
    
    res.json({
      success: true,
      message: 'Daily entry modified successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error modifying daily entry:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to modify daily entry',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// Delete payment (with rollback of effects)
app.delete('/admin/delete-payment/:paymentId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { paymentId } = req.params;

    // Get payment details before deletion
    const [payment] = await connection.query(
      'SELECT customer_id, amount_paid, payment_date FROM payments WHERE payment_id = ?',
      [paymentId]
    );

    if (payment.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // Get affected orders
    const [affectedOrders] = await connection.query(
      `SELECT order_id, quantity, price, paid_amount 
       FROM orders 
       WHERE customer_id = ? 
       AND order_date >= ? 
       AND payment_status IN ('Paid', 'Partially Paid')
       ORDER BY order_date ASC`,
      [payment[0].customer_id, payment[0].payment_date]
    );

    // Reset affected orders to pending
    for (const order of affectedOrders) {
      await connection.query(
        'UPDATE orders SET payment_status = ?, paid_amount = 0 WHERE order_id = ?',
        ['Pending', order.order_id]
      );
    }

    // Delete the payment
    await connection.query('DELETE FROM payments WHERE payment_id = ?', [paymentId]);

    // Recalculate advances and order payments after this point
    const [remainingPayments] = await connection.query(
      `SELECT amount_paid, payment_date 
       FROM payments 
       WHERE customer_id = ? 
       AND payment_date > ?
       ORDER BY payment_date ASC`,
      [payment[0].customer_id, payment[0].payment_date]
    );

    // Reapply remaining payments
    for (const remainingPayment of remainingPayments) {
      let availableMoney = Number(remainingPayment.amount_paid);
      
      for (const order of affectedOrders) {
        if (order.paid_amount === 0) {
          const orderTotal = Number(order.quantity) * Number(order.price);
          
          if (availableMoney >= orderTotal) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
              ['Paid', orderTotal, order.order_id]
            );
            availableMoney -= orderTotal;
          } else if (availableMoney > 0) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
              ['Partially Paid', availableMoney, order.order_id]
            );
            availableMoney = 0;
          }
        }
      }

      // Update advance if there's money left
      if (availableMoney > 0) {
        const [advanceRows] = await connection.query(
          'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
          [payment[0].customer_id]
        );

        if (advanceRows.length > 0) {
          await connection.query(
            'UPDATE customer_advances SET advance_amount = advance_amount + ? WHERE customer_id = ?',
            [availableMoney, payment[0].customer_id]
          );
        } else {
          await connection.query(
            'INSERT INTO customer_advances (customer_id, advance_amount) VALUES (?, ?)',
            [payment[0].customer_id, availableMoney]
          );
        }
      }
    }

    await connection.commit();
    
    res.json({
      success: true,
      message: 'Payment deleted successfully'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error deleting payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});
// Update payment status and record payment
app.post('/record-payment', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customer_id, amount_paid, payment_date = new Date() } = req.body;
    const processAmount = Number(amount_paid) || 0;

    if (processAmount <= 0) {
      throw new Error('Invalid payment amount');
    }

    // 1. Get current advance amount
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customer_id]
    );
    
    let currentAdvance = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    // 2. Insert payment record
    await connection.query(
      'INSERT INTO payments (customer_id, amount_paid, payment_date) VALUES (?, ?, ?)',
      [customer_id, processAmount, payment_date]
    );

    // 3. Get pending orders sorted by date
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id, 
        ROUND(quantity * price, 2) AS order_amount,
        COALESCE(paid_amount, 0) AS paid_amount, 
        payment_status,
        order_date
       FROM orders 
       WHERE customer_id = ? 
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [customer_id]
    );

    // 4. Calculate total available money (new payment + existing advance)
    let availableMoney = processAmount + currentAdvance;
    let newAdvanceAmount = 0;
    let totalPendingAmount = 0;

    // 5. Process each pending order
    for (const order of pendingOrders) {
      const orderTotal = Number(order.order_amount);
      const alreadyPaid = Number(order.paid_amount);
      const remainingForOrder = orderTotal - alreadyPaid;

      if (remainingForOrder > 0) {
        if (availableMoney >= remainingForOrder) {
          // Can pay full remaining amount
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Paid', orderTotal, order.order_id]
          );
          availableMoney = Number((availableMoney - remainingForOrder).toFixed(2));
        } else if (availableMoney > 0) {
          // Can pay partial amount
          const newPaidAmount = alreadyPaid + availableMoney;
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Partially Paid', newPaidAmount, order.order_id]
          );
          totalPendingAmount += (orderTotal - newPaidAmount);
          availableMoney = 0;
        } else {
          // No money left to pay
          totalPendingAmount += remainingForOrder;
        }
      }
    }

    // 6. Handle remaining money as advance
    if (availableMoney > 0) {
      newAdvanceAmount = availableMoney;
    }

    // 7. Update advance amount in database
    if (advanceRows.length > 0) {
      await connection.query(
        'UPDATE customer_advances SET advance_amount = ROUND(?, 2), updated_date = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [newAdvanceAmount, customer_id]
      );
    } else {
      await connection.query(
        'INSERT INTO customer_advances (customer_id, advance_amount, created_date) VALUES (?, ROUND(?, 2), CURRENT_TIMESTAMP)',
        [customer_id, newAdvanceAmount]
      );
    }

    // 8. Commit transaction
    await connection.commit();

    // 9. Send response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      advance_amount: newAdvanceAmount,
      pending_amount: totalPendingAmount,
      payment_details: {
        original_payment: processAmount,
        used_advance: currentAdvance,
        new_advance: newAdvanceAmount,
        total_pending: totalPendingAmount
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error recording payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});



// Get payment history
app.get('/payment-history/:customerId', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const query = `
      SELECT 
        p.payment_id,
        p.amount_paid,
        p.payment_date,
        c.name as customer_name
      FROM payments p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE p.customer_id = ?
      ORDER BY p.payment_date DESC
    `;
    
    const [rows] = await pool.query(query, [customerId]);
    res.json({ 
      success: true, 
      payments: rows 
    });
    
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch payment history',
      error: error.message 
    });
  }
});
// Add this route in your Express server file
app.get('/total-milk', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        c.customer_id,
        c.name AS customer_name,
        COALESCE(
          SUM(CASE 
            WHEN o.payment_status = 'Pending' THEN o.quantity
            WHEN o.payment_status = 'Partially Paid' THEN 
                o.quantity * ((o.quantity * o.price - COALESCE(o.paid_amount, 0)) / (o.quantity * o.price))
            ELSE 0
          END),
          0
        ) AS pending_milk_quantity,
        
        COALESCE(
          AVG(CASE 
            WHEN o.payment_status IN ('Pending', 'Partially Paid') THEN o.price
            ELSE NULL
          END),
          0
        ) AS price_per_liter,
        
        COALESCE(
          SUM(CASE 
            WHEN o.payment_status = 'Pending' THEN o.quantity * o.price
            WHEN o.payment_status = 'Partially Paid' THEN o.quantity * o.price - COALESCE(o.paid_amount, 0)
            ELSE 0
          END),
          0
        ) AS total_pending_amount
      FROM 
        customers c
      LEFT JOIN 
        orders o ON c.customer_id = o.customer_id
      WHERE 
        o.payment_status IN ('Pending', 'Partially Paid')
      GROUP BY 
        c.customer_id, c.name
      HAVING 
        pending_milk_quantity > 0 OR total_pending_amount > 0;
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      customers: rows.map(row => ({
        ...row,
        pending_milk_quantity: parseFloat(row.pending_milk_quantity),
        price_per_liter: parseFloat(row.price_per_liter),
        total_pending_amount: parseFloat(row.total_pending_amount)
      }))
    });
  } catch (error) {
    console.error('Error fetching total milk data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch total milk data',
      error: error.message
    });
  }
});


// Get all orders
app.post('/record-payment', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customer_id, amount_paid, payment_date = new Date() } = req.body;
    const processAmount = Number(amount_paid) || 0;

    if (processAmount <= 0) {
      throw new Error('Invalid payment amount');
    }

    // 1. Get current advance amount and pending orders
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customer_id]
    );
    
    const currentAdvance = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    // 2. Get total pending amount and orders
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id, 
        ROUND(quantity * price, 2) AS order_amount,
        COALESCE(paid_amount, 0) AS paid_amount, 
        payment_status,
        order_date
       FROM orders 
       WHERE customer_id = ? 
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [customer_id]
    );

    let totalPendingAmount = 0;
    pendingOrders.forEach(order => {
      totalPendingAmount += Number(order.order_amount) - Number(order.paid_amount);
    });
    totalPendingAmount = Number(totalPendingAmount.toFixed(2));

    // 3. Record the payment
    await connection.query(
      'INSERT INTO payments (customer_id, amount_paid, payment_date) VALUES (?, ?, ?)',
      [customer_id, processAmount, payment_date]
    );

    // 4. Process payment based on scenarios
    const totalAvailableMoney = processAmount + currentAdvance;
    let newAdvanceAmount = 0;
    let remainingPendingAmount = totalPendingAmount;

    // Determine scenario
    let scenario = '';
    if (totalPendingAmount === 0) {
      scenario = 'NO_PENDING';
    } else if (currentAdvance === 0) {
      scenario = 'NO_ADVANCE';
    } else {
      scenario = 'HAS_ADVANCE';
    }

    switch (scenario) {
      case 'NO_PENDING':
        // All money goes to advance
        newAdvanceAmount = totalAvailableMoney;
        remainingPendingAmount = 0;
        break;

      case 'NO_ADVANCE':
        if (processAmount >= totalPendingAmount) {
          // Full payment with excess
          newAdvanceAmount = processAmount - totalPendingAmount;
          remainingPendingAmount = 0;
          // Process all orders as fully paid
          for (const order of pendingOrders) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
              ['Paid', order.order_amount, order.order_id]
            );
          }
        } else {
          // Partial payment
          let remainingPayment = processAmount;
          for (const order of pendingOrders) {
            const orderTotal = Number(order.order_amount);
            const alreadyPaid = Number(order.paid_amount);
            const remainingForOrder = orderTotal - alreadyPaid;

            if (remainingPayment >= remainingForOrder) {
              // Can pay full remaining amount for this order
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Paid', orderTotal, order.order_id]
              );
              remainingPayment -= remainingForOrder;
            } else if (remainingPayment > 0) {
              // Can pay partial amount for this order
              const newPaidAmount = alreadyPaid + remainingPayment;
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Partially Paid', newPaidAmount, order.order_id]
              );
              remainingPayment = 0;
            }

            if (remainingPayment <= 0) break;
          }
          remainingPendingAmount = totalPendingAmount - processAmount;
        }
        break;

      case 'HAS_ADVANCE':
        if (totalAvailableMoney >= totalPendingAmount) {
          // Can pay all pending amounts
          newAdvanceAmount = totalAvailableMoney - totalPendingAmount;
          remainingPendingAmount = 0;
          // Process all orders as fully paid
          for (const order of pendingOrders) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
              ['Paid', order.order_amount, order.order_id]
            );
          }
        } else {
          // Partial payment with advance
          let remainingMoney = totalAvailableMoney;
          for (const order of pendingOrders) {
            const orderTotal = Number(order.order_amount);
            const alreadyPaid = Number(order.paid_amount);
            const remainingForOrder = orderTotal - alreadyPaid;

            if (remainingMoney >= remainingForOrder) {
              // Can pay full remaining amount for this order
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Paid', orderTotal, order.order_id]
              );
              remainingMoney -= remainingForOrder;
            } else if (remainingMoney > 0) {
              // Can pay partial amount for this order
              const newPaidAmount = alreadyPaid + remainingMoney;
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Partially Paid', newPaidAmount, order.order_id]
              );
              remainingMoney = 0;
            }

            if (remainingMoney <= 0) break;
          }
          remainingPendingAmount = totalPendingAmount - totalAvailableMoney;
        }
        break;
    }

    // 5. Update advance amount in database
    if (advanceRows.length > 0) {
      await connection.query(
        'UPDATE customer_advances SET advance_amount = ROUND(?, 2), updated_date = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [newAdvanceAmount, customer_id]
      );
    } else if (newAdvanceAmount > 0) {
      await connection.query(
        'INSERT INTO customer_advances (customer_id, advance_amount, created_date) VALUES (?, ROUND(?, 2), CURRENT_TIMESTAMP)',
        [customer_id, newAdvanceAmount]
      );
    }

    // 6. Commit transaction
    await connection.commit();

    // 7. Send response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      scenario: scenario,
      payment_details: {
        original_payment: processAmount,
        initial_advance: currentAdvance,
        total_pending_before: totalPendingAmount,
        new_advance_amount: newAdvanceAmount,
        remaining_pending_amount: remainingPendingAmount
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error recording payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});


// Fetch aggregated order data for Admins
app.get('/all-ordertwo', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    // Get all customers with their pending amounts and advances in a single query
    const query = `
      SELECT 
        c.customer_id,
        c.name AS customer_name,
        c.address AS customer_address,
        c.phone AS customer_phone,
        COALESCE(ca.advance_amount, 0) as advance_amount,
        COALESCE(
          (SELECT SUM(
            CASE 
              WHEN payment_status != 'Cancelled' AND payment_status != 'Paid'
              THEN (quantity * price) - COALESCE(paid_amount, 0)
              ELSE 0 
            END
          )
          FROM orders 
          WHERE customer_id = c.customer_id
          GROUP BY customer_id), 
          0
        ) as total_pending_before_advance
      FROM customers c
      LEFT JOIN customer_advances ca ON c.customer_id = ca.customer_id
    `;

    const [rows] = await pool.query(query);
    
    // Process each customer to calculate the final pending amount after considering advance
    const processedRows = rows.map(row => {
      const advance = Number(row.advance_amount);
      const totalPendingBeforeAdvance = Number(row.total_pending_before_advance);
      
      // Calculate the new pending amount and advance after applying the current advance
      let newPendingAmount;
      let newAdvanceAmount;
      
      if (advance >= totalPendingBeforeAdvance) {
        // If advance covers all pending amount
        newPendingAmount = 0;
        newAdvanceAmount = advance - totalPendingBeforeAdvance;
      } else {
        // If advance only covers part of pending amount
        newPendingAmount = totalPendingBeforeAdvance - advance;
        newAdvanceAmount = 0;
      }

      return {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_address: row.customer_address,
        customer_phone: row.customer_phone,
        advance_amount: newAdvanceAmount,
        pending_amount_due: newPendingAmount
      };
    });
    
    // Filter out customers with no pending amount and no advance
    const finalRows = processedRows.filter(row => 
      row.pending_amount_due > 0 || row.advance_amount > 0
    );
    
    res.json({ 
      success: true, 
      customers: finalRows 
    });
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching all orders',
      error: error.message 
    });
  }
});

// Fetch all customer details
app.get('/customers', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const { timing } = req.query; // Optional timing filter
    let query = 'SELECT * FROM customers WHERE admin_id = ?';
    const queryParams = [req.user.adminId];

    if (timing) {
      query += ' AND delivery_timing = ?';
      queryParams.push(timing);
    }

    const [rows] = await pool.query(query, queryParams);
    res.json({ 
      success: true,
      customers: rows 
    });
  } catch (err) {
    console.error('❌ Error fetching customers:', err.message);
    res.status(500).json({ 
      success: false,
      message: 'Error fetching customers' 
    });
  }
});


// Fetch customer orders
app.get('/orders', verifyToken, async (req, res) => {
  const customerId = req.user.customerId;

  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE customer_id = ?', [customerId]);
    res.json({ orders: rows });
  } catch (err) {
    console.error('❌ Error fetching orders:', err.message);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});
app.get('/all-orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const connection = await pool.getConnection();
  
  try {
    const { timing } = req.query; // Optional timing filter
    
    // Modified base query to include admin_id and delivery_timing filters
    let customerQuery = `
      SELECT 
        c.customer_id,
        c.name AS customer_name,
        c.address AS customer_address,
        c.phone AS customer_phone,
        c.delivery_timing,
        COALESCE(ca.advance_amount, 0) as advance_amount,
        COALESCE(
          (SELECT SUM(
            CASE 
              WHEN payment_status != 'Cancelled' AND payment_status != 'Paid'
              THEN (quantity * price) - COALESCE(paid_amount, 0)
              ELSE 0 
            END
          )
          FROM orders 
          WHERE customer_id = c.customer_id
          GROUP BY customer_id), 
          0
        ) as total_pending_before_advance,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'order_id', o.order_id,
              'quantity', o.quantity,
              'price', o.price,
              'order_date', DATE_FORMAT(o.order_date, '%Y-%m-%d'),
              'payment_status', o.payment_status,
              'paid_amount', COALESCE(o.paid_amount, 0),
              'total_amount', (o.quantity * o.price)
            )
          )
          FROM orders o
          WHERE o.customer_id = c.customer_id
          AND o.payment_status != 'Cancelled'
          ORDER BY o.order_date DESC
          LIMIT 30
        ) as recent_orders
      FROM customers c
      LEFT JOIN customer_advances ca ON c.customer_id = ca.customer_id
      WHERE c.admin_id = ?
    `;

    const queryParams = [req.user.adminId];

    if (timing) {
      customerQuery += ' AND c.delivery_timing = ?';
      queryParams.push(timing);
    }

    const [rows] = await connection.query(customerQuery, queryParams);
    
    // Process each customer's data
      const processedRows = rows.map(row => {
       const advance = Number(row.advance_amount);
      const totalPendingBeforeAdvance = Number(row.total_pending_before_advance);
      
      let newPendingAmount;
      let newAdvanceAmount;
      
      if (advance >= totalPendingBeforeAdvance) {
        newPendingAmount = 0;
        newAdvanceAmount = advance - totalPendingBeforeAdvance;
      } else {
        newPendingAmount = totalPendingBeforeAdvance - advance;
        newAdvanceAmount = 0;
      }

      let orders = [];
      try {
        if (row.recent_orders) {
          orders = JSON.parse(row.recent_orders);
        }
      } catch (e) {
        console.error('Error parsing orders for customer:', row.customer_id, e);
      }

      const orderStats = orders.reduce((acc, order) => {
        acc.total_quantity += Number(order.quantity);
        acc.total_amount += Number(order.total_amount);
        acc.total_paid += Number(order.paid_amount);
        return acc;
      }, { total_quantity: 0, total_amount: 0, total_paid: 0 });

      return {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_address: row.customer_address,
        customer_phone: row.customer_phone,
        delivery_timing: row.delivery_timing,
        advance_amount: newAdvanceAmount,
        pending_amount_due: newPendingAmount,
        orders: orders,
        order_stats: {
          total_orders: orders.length,
          total_quantity: orderStats.total_quantity,
          total_amount: orderStats.total_amount,
          total_paid: orderStats.total_paid,
          payment_completion_rate: orderStats.total_amount > 0 
            ? ((orderStats.total_paid / orderStats.total_amount) * 100).toFixed(2)
            : 100
        }
      };
    });

    const finalRows = processedRows.filter(row => 
      row.pending_amount_due > 0 || row.advance_amount > 0 || 
      (row.orders && row.orders.length > 0)
    );

    res.json({
      success: true,
      customers: finalRows,
      meta: {
        total_customers: finalRows.length,
        total_pending: finalRows.reduce((sum, row) => sum + row.pending_amount_due, 0),
        total_advance: finalRows.reduce((sum, row) => sum + row.advance_amount, 0),
      }
    });

  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching all orders',
      error: error.message
    });
  } finally {
    connection.release();
  }
});


// Add this to your existing server.js

// Add new customer
app.post('/customers', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { customerId, customerName, customerPassword, customerAddress, customerPhone } = req.body;

  // Input validation
  if (!customerId || !customerName || !customerPassword || !customerAddress || !customerPhone) {
    return res.status(400).json({ 
      success: false,
      message: 'All fields are required: customerId, customerName, customerPassword, customerAddress, customerPhone' 
    });
  }

  // Validate customer ID format (assuming it should be numeric)
  if (!/^\d+$/.test(customerId)) {
    return res.status(400).json({
      success: false,
      message: 'Customer ID must contain only numbers'
    });
  }

  // Validate phone number format
  if (!/^\+?[\d\s-]+$/.test(customerPhone)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid phone number format'
    });
  }

  try {
    // Check if customer ID already exists
    const [existing] = await pool.query(
      'SELECT customer_id FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Customer ID already exists'
      });
    }

    // Insert new customer
    const query = `
      INSERT INTO customers (customer_id, name, password, address, phone)
      VALUES (?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      customerId,
      customerName,
      customerPassword,
      customerAddress,
      customerPhone
    ]);

    res.status(201).json({
      success: true,
      message: 'Customer added successfully'
    });

  } catch (err) {
    console.error('❌ Error adding customer:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to add customer',
      error: err.message
    });
  }
});
// Fetch pending orders for a specific customer
app.get('/pending-orders/:customerId', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const query = `
      SELECT order_id, quantity * price AS order_amount, paid_amount 
      FROM orders 
      WHERE customer_id = ? AND payment_status != 'Paid'
    `;
    
    const [rows] = await pool.query(query, [customerId]);
    res.json({ success: true, pendingOrders: rows });
    
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending orders' });
  }
});


// Get customer's current advance amount
app.get('/customer-advance/:customerId', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    const advanceAmount = rows.length > 0 ? rows[0].advance_amount : 0;
    res.json({ success: true, advance_amount: advanceAmount });
  } catch (error) {
    console.error('Error fetching advance amount:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch advance amount' });
  }
});

// Update the discrepancy reporting route
app.post('/api/report-discrepancy', verifyToken, async (req, res) => {
  const { discrepancy } = req.body;
  const customerId = req.user.customerId;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [customerExists] = await connection.query(
      'SELECT customer_id FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (customerExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    await connection.query(
      `INSERT INTO discrepancy_reports 
       (customer_id, description, report_date, status) 
       VALUES (?, ?, NOW(), 'Pending')`,
      [customerId, discrepancy]
    );

    await connection.commit();

    res.json({ 
      success: true, 
      message: 'Discrepancy reported successfully'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error reporting discrepancy:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to report discrepancy',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// Get discrepancy reports for a customer
app.get('/discrepancy-reports/:customerId', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        dr.id,
        dr.description,
        dr.report_date,
        dr.status,
        dr.resolution_notes,
        dr.resolved_date
       FROM discrepancy_reports dr
       WHERE dr.customer_id = ?
       ORDER BY dr.report_date DESC`,
      [req.params.customerId]
    );
    
    res.json({ success: true, reports: rows });
  } catch (error) {
    console.error('Error fetching discrepancy reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch discrepancy reports' 
    });
  }
});

// Enhanced Transaction History
app.get('/transaction-history/:customerId', verifyToken, async (req, res) => {
  try {
    // Get all transactions including payments, orders, and advances
    const query = `
      SELECT 
        'payment' as type,
        p.payment_date as date,
        p.amount_paid as amount,
        NULL as description,
        NULL as quantity,
        NULL as price
      FROM payments p
      WHERE p.customer_id = ?
      
      UNION ALL
      
      SELECT 
        'order' as type,
        o.order_date as date,
        (o.quantity * o.price) as amount,
        CASE 
          WHEN o.payment_status = 'Pending' THEN 'Pending Payment'
          WHEN o.payment_status = 'Paid' THEN 'Order Paid'
          ELSE o.payment_status
        END as description,
        o.quantity,
        o.price
      FROM orders o
      WHERE o.customer_id = ?
      
      UNION ALL
      
      SELECT 
        'advance' as type,
        ca.created_date as date,
        ca.advance_amount as amount,
        'Advance Payment' as description,
        NULL as quantity,
        NULL as price
      FROM customer_advances ca
      WHERE ca.customer_id = ?
      ORDER BY date DESC
    `;
    
    const [rows] = await pool.query(query, [
      req.params.customerId,
      req.params.customerId,
      req.params.customerId
    ]);
    
    res.json({ 
      success: true, 
      transactions: rows 
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transaction history' 
    });
  }
});


// Update the customer statement route
app.get('/api/customer-statement/:customerId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Get customer details
    const [customerRows] = await connection.query(
      'SELECT customer_id, name, address, phone FROM customers WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    if (customerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get current advance amount
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    // Get pending orders
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id,
        order_date,
        quantity,
        price,
        quantity * price as total_amount,
        payment_status,
        COALESCE(paid_amount, 0) as paid_amount
       FROM orders
       WHERE customer_id = ?
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [req.params.customerId]
    );
    
    // Calculate total pending amount
    const totalPending = pendingOrders.reduce((sum, order) => 
      sum + (order.total_amount - order.paid_amount), 0
    );

    const statement = {
      customer: {
        id: customerRows[0].customer_id,
        name: customerRows[0].name,
        address: customerRows[0].address,
        phone: customerRows[0].phone
      },
      advance_amount: advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0,
      pending_orders: pendingOrders.map(order => ({
        ...order,
        total_amount: Number(order.total_amount),
        paid_amount: Number(order.paid_amount)
      })),
      total_pending: Number(totalPending)
    };
    
    res.json({ 
      success: true, 
      statement: statement 
    });

  } catch (error) {
    console.error('Error generating customer statement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate customer statement',
      error: error.message 
    });
  } finally {
    connection.release();
  }
});
// Admin: Get all discrepancy reports
app.get('/admin/discrepancy-reports', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT 
        dr.id,
        dr.customer_id,
        c.name as customer_name,
        dr.description,
        dr.report_date,
        dr.status,
        dr.resolution_notes,
        dr.resolved_date
       FROM discrepancy_reports dr
       JOIN customers c ON dr.customer_id = c.customer_id
       ORDER BY dr.report_date DESC`
    );
    
    res.json({ success: true, reports: rows });
  } catch (error) {
    console.error('Error fetching all discrepancy reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch discrepancy reports' 
    });
  }
});

// Admin: Resolve discrepancy report
app.post('/admin/resolve-discrepancy/:reportId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { resolution_notes } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Update discrepancy report
    await connection.query(
      `UPDATE discrepancy_reports 
       SET status = 'Resolved',
           resolution_notes = ?,
           resolved_date = NOW()
       WHERE id = ?`,
      [resolution_notes, req.params.reportId]
    );

    await connection.commit();
    
    res.json({ 
      success: true, 
      message: 'Discrepancy report resolved successfully' 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error resolving discrepancy report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve discrepancy report' 
    });
  } finally {
    connection.release();
  }
});

// Fetch user details (phone, address, and name)
app.get('/user-details/:customerId', verifyToken, async (req, res) => {
  const { customerId } = req.params;

  try {
    // Query to get user details from the customers table
    const [rows] = await pool.query(
      'SELECT name, phone, address FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    res.json({
      success: true,
      user: {
        name: user.name,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (err) {
    console.error('❌ Error fetching user details:', err.message);
    res.status(500).json({ message: 'Database error' });
  }
});


// Test endpoint
app.get('/', (req, res) => {
  res.send('✅ Server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
=======
const express = require('express');
const mysql = require('mysql2/promise'); // Changed to promise version
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001;

// Middleware
app.use('/api', express.Router());
app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

// MySQL Connection Pool (using promise-based connection)
const pool = mysql.createPool({
  host: 'sql12.freesqldatabase.com',
  user: 'sql12756236',
  password: '3x2ctS2Tlk',
  database: 'sql12756236',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Verify connection
const verifyConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to the remote MySQL database');
    connection.release();
  } catch (err) {
    console.error('❌ Error connecting to the database:', err.message);
    process.exit(1);
  }
};

verifyConnection();

// Middleware for verifying JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(403).json({ message: 'Authorization required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'defaultsecret', (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid token' });
    }
    req.user = decoded;
    next();
  });
};

// Customer Login API
app.post('/login', async (req, res) => {
  const { customerId, password } = req.body;

  if (!customerId || !password) {
    return res.status(400).json({ message: 'Customer ID and password are required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM customers WHERE customer_id = ?', [customerId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Customer ID not found' });
    }

    const user = rows[0];
    if (password !== user.password) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { customerId: user.customer_id, name: user.name, role: 'customer' },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '1h' }
    );

    return res.status(200).json({ message: 'Login successful', token });
  } catch (err) {
    console.error('❌ Error during login:', err.message);
    return res.status(500).json({ message: 'Database error' });
  }
});

// Admin Login API
app.post('/adminlogin', async (req, res) => {
  const { adminId, password } = req.body;

  if (!adminId || !password) {
    return res.status(400).json({ message: 'Admin email and password are required' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE email = ?', [adminId]);

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const admin = rows[0];
    if (password !== admin.password) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { adminId: admin.id, name: admin.name, role: 'admin' },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '1h' }
    );

    return res.status(200).json({ message: 'Admin Login successful', token });
  } catch (err) {
    console.error('❌ Error during admin login:', err.message);
    return res.status(500).json({ message: 'Database error' });
  }
});

// Create new order for daily entry
app.post('/daily-entry', verifyToken, async (req, res) => {
  const entries = req.body.entries; // Array of daily entries
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    for (const entry of entries) {
      const { customer_id, quantity, price, supplied } = entry;
      
      if (supplied) {
        const query = `
          INSERT INTO orders (customer_id, quantity, price, order_date, payment_status)
          VALUES (?, ?, ?, NOW(), 'Pending')
        `;
        
        await connection.query(query, [customer_id, quantity, price]);
      }
    }
    
    await connection.commit();
    res.status(200).json({ message: 'Daily entries recorded successfully' });
  } catch (error) {
    await connection.rollback();
    console.error('Error recording daily entries:', error);
    res.status(500).json({ message: 'Failed to record daily entries' });
  } finally {
    connection.release();
  }
});

// Add this to your existing server.js

// Update payment status and record payment
app.post('/record-payment', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customer_id, amount_paid, payment_date = new Date() } = req.body;
    const processAmount = Number(amount_paid) || 0;

    if (processAmount <= 0) {
      throw new Error('Invalid payment amount');
    }

    // 1. Get current advance amount
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customer_id]
    );
    
    let currentAdvance = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    // 2. Insert payment record
    await connection.query(
      'INSERT INTO payments (customer_id, amount_paid, payment_date) VALUES (?, ?, ?)',
      [customer_id, processAmount, payment_date]
    );

    // 3. Get pending orders sorted by date
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id, 
        ROUND(quantity * price, 2) AS order_amount,
        COALESCE(paid_amount, 0) AS paid_amount, 
        payment_status,
        order_date
       FROM orders 
       WHERE customer_id = ? 
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [customer_id]
    );

    // 4. Calculate total available money (new payment + existing advance)
    let availableMoney = processAmount + currentAdvance;
    let newAdvanceAmount = 0;
    let totalPendingAmount = 0;

    // 5. Process each pending order
    for (const order of pendingOrders) {
      const orderTotal = Number(order.order_amount);
      const alreadyPaid = Number(order.paid_amount);
      const remainingForOrder = orderTotal - alreadyPaid;

      if (remainingForOrder > 0) {
        if (availableMoney >= remainingForOrder) {
          // Can pay full remaining amount
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Paid', orderTotal, order.order_id]
          );
          availableMoney = Number((availableMoney - remainingForOrder).toFixed(2));
        } else if (availableMoney > 0) {
          // Can pay partial amount
          const newPaidAmount = alreadyPaid + availableMoney;
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Partially Paid', newPaidAmount, order.order_id]
          );
          totalPendingAmount += (orderTotal - newPaidAmount);
          availableMoney = 0;
        } else {
          // No money left to pay
          totalPendingAmount += remainingForOrder;
        }
      }
    }

    // 6. Handle remaining money as advance
    if (availableMoney > 0) {
      newAdvanceAmount = availableMoney;
    }

    // 7. Update advance amount in database
    if (advanceRows.length > 0) {
      await connection.query(
        'UPDATE customer_advances SET advance_amount = ROUND(?, 2), updated_date = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [newAdvanceAmount, customer_id]
      );
    } else {
      await connection.query(
        'INSERT INTO customer_advances (customer_id, advance_amount, created_date) VALUES (?, ROUND(?, 2), CURRENT_TIMESTAMP)',
        [customer_id, newAdvanceAmount]
      );
    }

    // 8. Commit transaction
    await connection.commit();

    // 9. Send response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      advance_amount: newAdvanceAmount,
      pending_amount: totalPendingAmount,
      payment_details: {
        original_payment: processAmount,
        used_advance: currentAdvance,
        new_advance: newAdvanceAmount,
        total_pending: totalPendingAmount
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error recording payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});



// Get payment history
app.get('/payment-history/:customerId', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const query = `
      SELECT 
        p.payment_id,
        p.amount_paid,
        p.payment_date,
        c.name as customer_name
      FROM payments p
      JOIN customers c ON p.customer_id = c.customer_id
      WHERE p.customer_id = ?
      ORDER BY p.payment_date DESC
    `;
    
    const [rows] = await pool.query(query, [customerId]);
    res.json({ 
      success: true, 
      payments: rows 
    });
    
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch payment history',
      error: error.message 
    });
  }
});
// Add this route in your Express server file
app.get('/total-milk', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        c.customer_id,
        c.name AS customer_name,
        COALESCE(
          SUM(CASE 
            WHEN o.payment_status = 'Pending' THEN o.quantity
            WHEN o.payment_status = 'Partially Paid' THEN 
                o.quantity * ((o.quantity * o.price - COALESCE(o.paid_amount, 0)) / (o.quantity * o.price))
            ELSE 0
          END),
          0
        ) AS pending_milk_quantity,
        
        COALESCE(
          AVG(CASE 
            WHEN o.payment_status IN ('Pending', 'Partially Paid') THEN o.price
            ELSE NULL
          END),
          0
        ) AS price_per_liter,
        
        COALESCE(
          SUM(CASE 
            WHEN o.payment_status = 'Pending' THEN o.quantity * o.price
            WHEN o.payment_status = 'Partially Paid' THEN o.quantity * o.price - COALESCE(o.paid_amount, 0)
            ELSE 0
          END),
          0
        ) AS total_pending_amount
      FROM 
        customers c
      LEFT JOIN 
        orders o ON c.customer_id = o.customer_id
      WHERE 
        o.payment_status IN ('Pending', 'Partially Paid')
      GROUP BY 
        c.customer_id, c.name
      HAVING 
        pending_milk_quantity > 0 OR total_pending_amount > 0;
    `;

    const [rows] = await pool.query(query);

    res.json({
      success: true,
      customers: rows.map(row => ({
        ...row,
        pending_milk_quantity: parseFloat(row.pending_milk_quantity),
        price_per_liter: parseFloat(row.price_per_liter),
        total_pending_amount: parseFloat(row.total_pending_amount)
      }))
    });
  } catch (error) {
    console.error('Error fetching total milk data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch total milk data',
      error: error.message
    });
  }
});


// Get all orders
app.post('/record-payment', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customer_id, amount_paid, payment_date = new Date() } = req.body;
    const processAmount = Number(amount_paid) || 0;

    if (processAmount <= 0) {
      throw new Error('Invalid payment amount');
    }

    // 1. Get current advance amount and pending orders
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customer_id]
    );
    
    const currentAdvance = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    // 2. Get total pending amount and orders
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id, 
        ROUND(quantity * price, 2) AS order_amount,
        COALESCE(paid_amount, 0) AS paid_amount, 
        payment_status,
        order_date
       FROM orders 
       WHERE customer_id = ? 
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [customer_id]
    );

    let totalPendingAmount = 0;
    pendingOrders.forEach(order => {
      totalPendingAmount += Number(order.order_amount) - Number(order.paid_amount);
    });
    totalPendingAmount = Number(totalPendingAmount.toFixed(2));

    // 3. Record the payment
    await connection.query(
      'INSERT INTO payments (customer_id, amount_paid, payment_date) VALUES (?, ?, ?)',
      [customer_id, processAmount, payment_date]
    );

    // 4. Process payment based on scenarios
    const totalAvailableMoney = processAmount + currentAdvance;
    let newAdvanceAmount = 0;
    let remainingPendingAmount = totalPendingAmount;

    // Determine scenario
    let scenario = '';
    if (totalPendingAmount === 0) {
      scenario = 'NO_PENDING';
    } else if (currentAdvance === 0) {
      scenario = 'NO_ADVANCE';
    } else {
      scenario = 'HAS_ADVANCE';
    }

    switch (scenario) {
      case 'NO_PENDING':
        // All money goes to advance
        newAdvanceAmount = totalAvailableMoney;
        remainingPendingAmount = 0;
        break;

      case 'NO_ADVANCE':
        if (processAmount >= totalPendingAmount) {
          // Full payment with excess
          newAdvanceAmount = processAmount - totalPendingAmount;
          remainingPendingAmount = 0;
          // Process all orders as fully paid
          for (const order of pendingOrders) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
              ['Paid', order.order_amount, order.order_id]
            );
          }
        } else {
          // Partial payment
          let remainingPayment = processAmount;
          for (const order of pendingOrders) {
            const orderTotal = Number(order.order_amount);
            const alreadyPaid = Number(order.paid_amount);
            const remainingForOrder = orderTotal - alreadyPaid;

            if (remainingPayment >= remainingForOrder) {
              // Can pay full remaining amount for this order
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Paid', orderTotal, order.order_id]
              );
              remainingPayment -= remainingForOrder;
            } else if (remainingPayment > 0) {
              // Can pay partial amount for this order
              const newPaidAmount = alreadyPaid + remainingPayment;
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Partially Paid', newPaidAmount, order.order_id]
              );
              remainingPayment = 0;
            }

            if (remainingPayment <= 0) break;
          }
          remainingPendingAmount = totalPendingAmount - processAmount;
        }
        break;

      case 'HAS_ADVANCE':
        if (totalAvailableMoney >= totalPendingAmount) {
          // Can pay all pending amounts
          newAdvanceAmount = totalAvailableMoney - totalPendingAmount;
          remainingPendingAmount = 0;
          // Process all orders as fully paid
          for (const order of pendingOrders) {
            await connection.query(
              'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
              ['Paid', order.order_amount, order.order_id]
            );
          }
        } else {
          // Partial payment with advance
          let remainingMoney = totalAvailableMoney;
          for (const order of pendingOrders) {
            const orderTotal = Number(order.order_amount);
            const alreadyPaid = Number(order.paid_amount);
            const remainingForOrder = orderTotal - alreadyPaid;

            if (remainingMoney >= remainingForOrder) {
              // Can pay full remaining amount for this order
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Paid', orderTotal, order.order_id]
              );
              remainingMoney -= remainingForOrder;
            } else if (remainingMoney > 0) {
              // Can pay partial amount for this order
              const newPaidAmount = alreadyPaid + remainingMoney;
              await connection.query(
                'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
                ['Partially Paid', newPaidAmount, order.order_id]
              );
              remainingMoney = 0;
            }

            if (remainingMoney <= 0) break;
          }
          remainingPendingAmount = totalPendingAmount - totalAvailableMoney;
        }
        break;
    }

    // 5. Update advance amount in database
    if (advanceRows.length > 0) {
      await connection.query(
        'UPDATE customer_advances SET advance_amount = ROUND(?, 2), updated_date = CURRENT_TIMESTAMP WHERE customer_id = ?',
        [newAdvanceAmount, customer_id]
      );
    } else if (newAdvanceAmount > 0) {
      await connection.query(
        'INSERT INTO customer_advances (customer_id, advance_amount, created_date) VALUES (?, ROUND(?, 2), CURRENT_TIMESTAMP)',
        [customer_id, newAdvanceAmount]
      );
    }

    // 6. Commit transaction
    await connection.commit();

    // 7. Send response
    res.status(200).json({
      success: true,
      message: 'Payment processed successfully',
      scenario: scenario,
      payment_details: {
        original_payment: processAmount,
        initial_advance: currentAdvance,
        total_pending_before: totalPendingAmount,
        new_advance_amount: newAdvanceAmount,
        remaining_pending_amount: remainingPendingAmount
      }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error recording payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record payment',
      error: error.message
    });
  } finally {
    connection.release();
  }
});



// Fetch all customer details
app.get('/customers', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const [rows] = await pool.query('SELECT * FROM customers');
    res.json({ customers: rows });
  } catch (err) {
    console.error('❌ Error fetching customers:', err.message);
    res.status(500).json({ message: 'Error fetching customers' });
  }
});

// Fetch customer orders
app.get('/orders', verifyToken, async (req, res) => {
  const customerId = req.user.customerId;

  try {
    const [rows] = await pool.query('SELECT * FROM orders WHERE customer_id = ?', [customerId]);
    res.json({ orders: rows });
  } catch (err) {
    console.error('❌ Error fetching orders:', err.message);
    res.status(500).json({ message: 'Error fetching orders' });
  }
});

// Fetch aggregated order data for Admins
app.get('/all-orders', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    // Get all customers with their pending amounts and advances in a single query
    const query = `
      SELECT 
        c.customer_id,
        c.name AS customer_name,
        c.address AS customer_address,
        c.phone AS customer_phone,
        COALESCE(ca.advance_amount, 0) as advance_amount,
        COALESCE(
          (SELECT SUM(
            CASE 
              WHEN payment_status != 'Cancelled' AND payment_status != 'Paid'
              THEN (quantity * price) - COALESCE(paid_amount, 0)
              ELSE 0 
            END
          )
          FROM orders 
          WHERE customer_id = c.customer_id
          GROUP BY customer_id), 
          0
        ) as total_pending_before_advance
      FROM customers c
      LEFT JOIN customer_advances ca ON c.customer_id = ca.customer_id
    `;

    const [rows] = await pool.query(query);
    
    // Process each customer to calculate the final pending amount after considering advance
    const processedRows = rows.map(row => {
      const advance = Number(row.advance_amount);
      const totalPendingBeforeAdvance = Number(row.total_pending_before_advance);
      
      // Calculate the new pending amount and advance after applying the current advance
      let newPendingAmount;
      let newAdvanceAmount;
      
      if (advance >= totalPendingBeforeAdvance) {
        // If advance covers all pending amount
        newPendingAmount = 0;
        newAdvanceAmount = advance - totalPendingBeforeAdvance;
      } else {
        // If advance only covers part of pending amount
        newPendingAmount = totalPendingBeforeAdvance - advance;
        newAdvanceAmount = 0;
      }

      return {
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_address: row.customer_address,
        customer_phone: row.customer_phone,
        advance_amount: newAdvanceAmount,
        pending_amount_due: newPendingAmount
      };
    });
    
    // Filter out customers with no pending amount and no advance
    const finalRows = processedRows.filter(row => 
      row.pending_amount_due > 0 || row.advance_amount > 0
    );
    
    res.json({ 
      success: true, 
      customers: finalRows 
    });
  } catch (error) {
    console.error('Error fetching all orders:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error fetching all orders',
      error: error.message 
    });
  }
});


// Add this to your existing server.js

// Add new customer
app.post('/customers', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { customerId, customerName, customerPassword, customerAddress, customerPhone } = req.body;

  // Input validation
  if (!customerId || !customerName || !customerPassword || !customerAddress || !customerPhone) {
    return res.status(400).json({ 
      success: false,
      message: 'All fields are required: customerId, customerName, customerPassword, customerAddress, customerPhone' 
    });
  }

  // Validate customer ID format (assuming it should be numeric)
  if (!/^\d+$/.test(customerId)) {
    return res.status(400).json({
      success: false,
      message: 'Customer ID must contain only numbers'
    });
  }

  // Validate phone number format
  if (!/^\+?[\d\s-]+$/.test(customerPhone)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid phone number format'
    });
  }

  try {
    // Check if customer ID already exists
    const [existing] = await pool.query(
      'SELECT customer_id FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Customer ID already exists'
      });
    }

    // Insert new customer
    const query = `
      INSERT INTO customers (customer_id, name, password, address, phone)
      VALUES (?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      customerId,
      customerName,
      customerPassword,
      customerAddress,
      customerPhone
    ]);

    res.status(201).json({
      success: true,
      message: 'Customer added successfully'
    });

  } catch (err) {
    console.error('❌ Error adding customer:', err.message);
    res.status(500).json({
      success: false,
      message: 'Failed to add customer',
      error: err.message
    });
  }
});
// Fetch pending orders for a specific customer
app.get('/pending-orders/:customerId', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const query = `
      SELECT order_id, quantity * price AS order_amount, paid_amount 
      FROM orders 
      WHERE customer_id = ? AND payment_status != 'Paid'
    `;
    
    const [rows] = await pool.query(query, [customerId]);
    res.json({ success: true, pendingOrders: rows });
    
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending orders' });
  }
});


// Get customer's current advance amount
app.get('/customer-advance/:customerId', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    const advanceAmount = rows.length > 0 ? rows[0].advance_amount : 0;
    res.json({ success: true, advance_amount: advanceAmount });
  } catch (error) {
    console.error('Error fetching advance amount:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch advance amount' });
  }
});

// Update the discrepancy reporting route
app.post('/api/report-discrepancy', verifyToken, async (req, res) => {
  const { discrepancy } = req.body;
  const customerId = req.user.customerId;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [customerExists] = await connection.query(
      'SELECT customer_id FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (customerExists.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    await connection.query(
      `INSERT INTO discrepancy_reports 
       (customer_id, description, report_date, status) 
       VALUES (?, ?, NOW(), 'Pending')`,
      [customerId, discrepancy]
    );

    await connection.commit();

    res.json({ 
      success: true, 
      message: 'Discrepancy reported successfully'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error reporting discrepancy:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to report discrepancy',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// Get discrepancy reports for a customer
app.get('/discrepancy-reports/:customerId', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT 
        dr.id,
        dr.description,
        dr.report_date,
        dr.status,
        dr.resolution_notes,
        dr.resolved_date
       FROM discrepancy_reports dr
       WHERE dr.customer_id = ?
       ORDER BY dr.report_date DESC`,
      [req.params.customerId]
    );
    
    res.json({ success: true, reports: rows });
  } catch (error) {
    console.error('Error fetching discrepancy reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch discrepancy reports' 
    });
  }
});

// Enhanced Transaction History
app.get('/transaction-history/:customerId', verifyToken, async (req, res) => {
  try {
    // Get all transactions including payments, orders, and advances
    const query = `
      SELECT 
        'payment' as type,
        p.payment_date as date,
        p.amount_paid as amount,
        NULL as description,
        NULL as quantity,
        NULL as price
      FROM payments p
      WHERE p.customer_id = ?
      
      UNION ALL
      
      SELECT 
        'order' as type,
        o.order_date as date,
        (o.quantity * o.price) as amount,
        CASE 
          WHEN o.payment_status = 'Pending' THEN 'Pending Payment'
          WHEN o.payment_status = 'Paid' THEN 'Order Paid'
          ELSE o.payment_status
        END as description,
        o.quantity,
        o.price
      FROM orders o
      WHERE o.customer_id = ?
      
      UNION ALL
      
      SELECT 
        'advance' as type,
        ca.created_date as date,
        ca.advance_amount as amount,
        'Advance Payment' as description,
        NULL as quantity,
        NULL as price
      FROM customer_advances ca
      WHERE ca.customer_id = ?
      ORDER BY date DESC
    `;
    
    const [rows] = await pool.query(query, [
      req.params.customerId,
      req.params.customerId,
      req.params.customerId
    ]);
    
    res.json({ 
      success: true, 
      transactions: rows 
    });
  } catch (error) {
    console.error('Error fetching transaction history:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch transaction history' 
    });
  }
});


// Update the customer statement route
app.get('/api/customer-statement/:customerId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Get customer details
    const [customerRows] = await connection.query(
      'SELECT customer_id, name, address, phone FROM customers WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    if (customerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get current advance amount
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [req.params.customerId]
    );
    
    // Get pending orders
    const [pendingOrders] = await connection.query(
      `SELECT 
        order_id,
        order_date,
        quantity,
        price,
        quantity * price as total_amount,
        payment_status,
        COALESCE(paid_amount, 0) as paid_amount
       FROM orders
       WHERE customer_id = ?
       AND payment_status != 'Paid'
       AND payment_status != 'Cancelled'
       ORDER BY order_date ASC`,
      [req.params.customerId]
    );
    
    // Calculate total pending amount
    const totalPending = pendingOrders.reduce((sum, order) => 
      sum + (order.total_amount - order.paid_amount), 0
    );

    const statement = {
      customer: {
        id: customerRows[0].customer_id,
        name: customerRows[0].name,
        address: customerRows[0].address,
        phone: customerRows[0].phone
      },
      advance_amount: advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0,
      pending_orders: pendingOrders.map(order => ({
        ...order,
        total_amount: Number(order.total_amount),
        paid_amount: Number(order.paid_amount)
      })),
      total_pending: Number(totalPending)
    };
    
    res.json({ 
      success: true, 
      statement: statement 
    });

  } catch (error) {
    console.error('Error generating customer statement:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to generate customer statement',
      error: error.message 
    });
  } finally {
    connection.release();
  }
});
// Admin: Get all discrepancy reports
app.get('/admin/discrepancy-reports', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  try {
    const [rows] = await pool.query(
      `SELECT 
        dr.id,
        dr.customer_id,
        c.name as customer_name,
        dr.description,
        dr.report_date,
        dr.status,
        dr.resolution_notes,
        dr.resolved_date
       FROM discrepancy_reports dr
       JOIN customers c ON dr.customer_id = c.customer_id
       ORDER BY dr.report_date DESC`
    );
    
    res.json({ success: true, reports: rows });
  } catch (error) {
    console.error('Error fetching all discrepancy reports:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch discrepancy reports' 
    });
  }
});

// Admin: Resolve discrepancy report
app.post('/admin/resolve-discrepancy/:reportId', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const { resolution_notes } = req.body;
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Update discrepancy report
    await connection.query(
      `UPDATE discrepancy_reports 
       SET status = 'Resolved',
           resolution_notes = ?,
           resolved_date = NOW()
       WHERE id = ?`,
      [resolution_notes, req.params.reportId]
    );

    await connection.commit();
    
    res.json({ 
      success: true, 
      message: 'Discrepancy report resolved successfully' 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error resolving discrepancy report:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to resolve discrepancy report' 
    });
  } finally {
    connection.release();
  }
});

// Fetch user details (phone, address, and name)
app.get('/user-details/:customerId', verifyToken, async (req, res) => {
  const { customerId } = req.params;

  try {
    // Query to get user details from the customers table
    const [rows] = await pool.query(
      'SELECT name, phone, address FROM customers WHERE customer_id = ?',
      [customerId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = rows[0];

    res.json({
      success: true,
      user: {
        name: user.name,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (err) {
    console.error('❌ Error fetching user details:', err.message);
    res.status(500).json({ message: 'Database error' });
  }
});


// Test endpoint
app.get('/', (req, res) => {
  res.send('✅ Server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
>>>>>>> 706af76 (altered port)
