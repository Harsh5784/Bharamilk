const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();
const router = express.Router();
const app = express();
// Use a different port if 8080 is taken, or allow it to be configured
const port = process.env.PORT || 13000;

// Middleware
app.use(cors({ origin: '*', methods: ['GET', 'POST'], credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Connection pooling configuration 
const pool = mysql.createPool({
  host: '147.93.105.134',
  user: 'HarshBharatMilk',
  password: 'Harsh57845784BharatMilk',
  database: 'BharatMilk',
  port: 3306,
  waitForConnections: true,
  connectionLimit: 70,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  namedPlaceholders: true
});

// Verify connection
const verifyConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to the remote MySQL database');
    connection.release();
  } catch (err) {
    console.error('❌ Error connecting to the database:', err.message);
    setTimeout(verifyConnection, 5000);
  }
};
verifyConnection();

// Initialize WhatsApp client with more robust error handling
let client = null;
try {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      // Additional arguments to help with common issues
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    }
  });

  client.on('qr', (qr) => {
    console.log('QR RECEIVED. Scan this with your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

  client.on('ready', () => {
    console.log('✅ WhatsApp client is ready!');
  });

  client.on('authenticated', () => {
    console.log('✅ WhatsApp authentication successful');
  });

  client.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp authentication failed:', msg);
  });

  // Initialize WhatsApp client
  client.initialize().catch(err => {
    console.error('Failed to initialize WhatsApp client:', err.message);
    console.log('Please install the required dependencies with:');
    console.log('sudo apt-get install -y gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget');
  });
} catch (err) {
  console.error('Error creating WhatsApp client:', err.message);
}

// JWT token verification middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(403).json({ 
      success: false,
      message: 'Authorization required' 
    });
  }
  
  try {
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'defaultsecret',
      { algorithms: ['HS256'] }
    );
    
    req.user = {
      role: decoded.role,
      admin_id: decoded.admin_id,
      email: decoded.email,
      name: decoded.name
    };
    next();
  } catch (err) {
    return res.status(403).json({ 
      success: false,
      message: 'Invalid token' 
    });
  }
};

// Cached customer lookup for frequently accessed customers
const customerCache = new Map();
const CACHE_TTL = 300000; // 5 minutes in milliseconds

// Customer login logic
app.post('/login', async (req, res) => {
  const { customerId, password } = req.body;
  
  if (!customerId || !password) {
    return res.status(400).json({ message: 'Customer ID and password are required' });
  }
  
  try {
    const cacheKey = `customer:${customerId}`;
    let user;
    
    if (customerCache.has(cacheKey)) {
      user = customerCache.get(cacheKey);
    } else {
      const [rows] = await pool.query(
        'SELECT customer_id, admin_id, name, password, phone FROM customers WHERE customer_id = ?', 
        [customerId]
      );
      
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Customer ID not found' });
      }
      
      user = rows[0];
      
      customerCache.set(cacheKey, user);
      setTimeout(() => customerCache.delete(cacheKey), CACHE_TTL);
    }
    
    if (password !== user.password) {
      return res.status(401).json({ message: 'Incorrect password' });
    }
    
const token = jwt.sign(
  { 
    admin_id: user.admin_id, 
    name: user.name, 
    role: 'admin',
    iat: Math.floor(Date.now() / 1000) // Issued at
  },
  process.env.JWT_SECRET || 'defaultsecret',
  { algorithm: 'HS256' }  // Removed 'expiresIn'
);

    
    return res.status(200).json({ 
      success: true,
      message: 'Login successful', 
      token 
    });
  } catch (err) {
    console.error('❌ Error during login:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Admin login endpoint
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

    // Generate token with consistent admin_id field
    const token = jwt.sign(
      {
        admin_id: admin.admin_id,
        email: admin.email,
        name: admin.name,
        role: 'admin'
      },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '30d' } // Access token valid for 2 hours
    );
    
    const refreshToken = jwt.sign(
      { admin_id: admin.admin_id },
      process.env.REFRESH_SECRET || 'defaultrefreshsecret',
      { expiresIn: '30d' } // Refresh token valid for 30 days
    );
    
    // Store refresh token in a secure cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: true, // Use true if deploying with HTTPS
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
    });
    
    return res.status(200).json({
      message: 'Login successful',
      token,
      admin: {
        admin_id: admin.admin_id,
        name: admin.name,
        email: admin.email
      }
    });
    


  } catch (err) {
    console.error('❌ Error during admin login:', err.message);
    return res.status(500).json({ message: 'Database error' });
  }
});

// Admin creation endpoint with improved error handling
app.post('/admin/create', async (req, res) => {
  const { name, password, email, phone_number, language } = req.body;
  
  // Validate required fields
  if (!name || !password || !email) {
    return res.status(400).json({ 
      success: false,
      message: 'Name, password, and email are required' 
    });
  }
  
  try {
    console.log('Creating admin with:', { name, email, phone_number });
    
    // Check if email already exists - case insensitive
    const [existingAdmin] = await pool.query('SELECT * FROM admins WHERE LOWER(email) = LOWER(?)', [email]);
    
    if (existingAdmin.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Email already in use'
      });
    }
    
    // Generate a unique admin_id (next available number)
    const [lastAdminResult] = await pool.query('SELECT MAX(admin_id) as max_id FROM admins');
    const lastAdminId = lastAdminResult[0].max_id || 202500;
    const newAdminId = parseInt(lastAdminId) + 1;
    
    // Set default values
    const currentDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const subscriptionStatus = 'active';
    const paymentAmount = 0.00;
    
    // Use named placeholders for clearer debugging
    const params = {
      admin_id: newAdminId,
      name: name,
      password: password,
      email: email,
      phone_number: phone_number || null,
      pincode: null,
      created_at: currentDate,
      subscription_status: subscriptionStatus,
      subscription_expiry: null,
      last_payment_date: null,
      payment_amount: paymentAmount,
      language: language || 2
    };
    
    console.log('Inserting admin with ID:', newAdminId);
    
    // Insert new admin with named placeholders
    await pool.query(
      `INSERT INTO admins (
        admin_id, name, password, email, phone_number, pincode, 
        created_at, subscription_status, subscription_expiry, 
        last_payment_date, payment_amount, language
      ) VALUES (
        :admin_id, :name, :password, :email, :phone_number, :pincode, 
        :created_at, :subscription_status, :subscription_expiry, 
        :last_payment_date, :payment_amount, :language
      )`,
      params
    );
    
    // Generate token for the new admin
    const token = jwt.sign(
      {
        admin_id: newAdminId,
        email: email,
        name: name,
        role: 'admin'
      },
      process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? undefined : 'defaultsecret'),
      { expiresIn: '30d' }
    );
    
    return res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      admin: {
        admin_id: newAdminId,
        name: name,
        email: email
      },
      token
    });
    
  } catch (err) {
    console.error('❌ Error creating admin:', err);
    // Send more detailed error information for debugging
    return res.status(500).json({ 
      success: false,
      message: 'Server error during admin creation',
      error: err.message,
      code: err.code,
      sqlState: err.sqlState
    });
  }
});

app.post('/send-whatsapp', async (req, res) => {
  const { customerId, number, message, count = 1 } = req.body;

  // Validate if either customerId or number is provided, along with message
  if ((!customerId && !number) || !message) {
    return res.status(400).json({ 
      success: false, 
      message: 'Either customer ID or phone number, and message are required' 
    });
  }

  // Check if WhatsApp service is ready
  if (!client || !client.info) {
    return res.status(503).json({ 
      success: false, 
      message: 'WhatsApp service not ready. Please scan the QR code to connect.' 
    });
  }

  try {
    let phoneNumber;
    let customerName = 'Customer';

    // If customerId is provided, fetch customer info from database
    if (customerId) {
      const [rows] = await pool.query(
        'SELECT name, phone FROM customers WHERE customer_id = ?', 
        [customerId]
      );

      if (rows.length > 0 && rows[0].phone) {
        phoneNumber = rows[0].phone.replace(/\D/g, ''); // Remove non-digit characters
        customerName = rows[0].name || 'Customer';
      } else {
        return res.status(404).json({ success: false, message: 'Customer not found or invalid phone' });
      }
    } else if (number) {
      phoneNumber = number.replace(/\D/g, ''); // Remove non-digit characters
    }

    // Add country code if missing (India by default)
    if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
      phoneNumber = '91' + phoneNumber;
    }

    const formattedNumber = `${phoneNumber}@c.us`; // Format number with WhatsApp's '@c.us' domain
    const personalizedMessage = message.replace('{{name}}', customerName);

    // Send the message (sending only one message here)
    const sentMessage = await client.sendMessage(formattedNumber, personalizedMessage);

    // Log the sent message to the database
    try {
      await pool.query(
        'INSERT INTO whatsapp_sent_messages (to_number, message, sent_by_admin, admin_id, sent_at) VALUES (?, ?, ?, ?, NOW())',
        [formattedNumber, personalizedMessage, false, null]
      );
    } catch (dbErr) {
      console.error('Failed to log message:', dbErr.message);
    }

    // Respond with success
    return res.status(200).json({ 
      success: true, 
      message: `Successfully sent message`,
      results: [{ messageId: sentMessage.id.id, index: 1 }]
    });

  } catch (err) {
    console.error('❌ Error sending WhatsApp message:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to send WhatsApp message',
      error: err.message 
    });
  }
});


// Combined Language API for both Admins and Customers

// GET endpoint to fetch language preference (works for both admin and customer)
app.get('/api/language', verifyToken, async (req, res) => {
  try {
    const { user_type, id } = req.query;
    
    if (!user_type || !id) {
      return res.status(400).json({
        success: false,
        message: 'User type and ID are required'
      });
    }
    
    // Validate user type
    if (user_type !== 'admin' && user_type !== 'customer') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Must be "admin" or "customer"'
      });
    }
    
    let query, tableName;
    
    if (user_type === 'admin') {
      tableName = 'admins';
      query = 'SELECT admin_id as id, language FROM admins WHERE admin_id = ?';
    } else {
      tableName = 'customers';
      query = 'SELECT customer_id as id, language FROM customers WHERE customer_id = ?';
    }
    
    const [rows] = await pool.query(query, [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `${user_type.charAt(0).toUpperCase() + user_type.slice(1)} not found`
      });
    }
    
    // Map the numeric value to language name
    let languageName = 'English'; // Default to English
    if (rows[0].language === 1) {
      languageName = 'Hindi';
    } else if (rows[0].language === 2) {
      languageName = 'English';
    }
    
    return res.status(200).json({
      success: true,
      data: {
        id: rows[0].id,
        user_type: user_type,
        language_code: rows[0].language || 2, // Default to 2 (English) if null
        language_name: languageName
      }
    });
  } catch (err) {
    console.error(`❌ Error fetching ${req.query.user_type} language:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT endpoint to update language preference (works for both admin and customer)
app.put('/api/language', verifyToken, async (req, res) => {
  try {
    const { user_type, id, language_code } = req.body;
    
    if (!user_type || !id || language_code === undefined) {
      return res.status(400).json({
        success: false,
        message: 'User type, ID, and language code are required'
      });
    }
    
    // Validate user type
    if (user_type !== 'admin' && user_type !== 'customer') {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Must be "admin" or "customer"'
      });
    }
    
    // Validate language input - only allow 1 (Hindi) or 2 (English)
    if (language_code !== 1 && language_code !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Invalid language code. Only 1 (Hindi) or 2 (English) are supported'
      });
    }
    
    let checkQuery, updateQuery, idField;
    
    if (user_type === 'admin') {
      idField = 'admin_id';
      checkQuery = 'SELECT admin_id FROM admins WHERE admin_id = ?';
      updateQuery = 'UPDATE admins SET language = ? WHERE admin_id = ?';
    } else {
      idField = 'customer_id';
      checkQuery = 'SELECT customer_id FROM customers WHERE customer_id = ?';
      updateQuery = 'UPDATE customers SET language = ? WHERE customer_id = ?';
    }
    
    // Check if user exists
    const [checkRows] = await pool.query(checkQuery, [id]);
    
    if (checkRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `${user_type.charAt(0).toUpperCase() + user_type.slice(1)} not found`
      });
    }
    
    // Update language preference
    await pool.query(updateQuery, [language_code, id]);
    
    // Clear cache if it's a customer
    if (user_type === 'customer') {
      const cacheKey = `customer:${id}`;
      if (customerCache.has(cacheKey)) {
        customerCache.delete(cacheKey);
      }
    }
    
    const languageName = language_code === 1 ? 'Hindi' : 'English';
    
    return res.status(200).json({
      success: true,
      message: 'Language preference updated successfully',
      data: {
        id,
        user_type,
        language_code,
        language_name: languageName
      }
    });
  } catch (err) {
    console.error(`❌ Error updating ${req.body.user_type} language:`, err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});


// Admin endpoint to fetch all users (customers and admins) with their language preferences
app.get('/api/admin/users/languages', verifyToken, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Admin privileges required'
      });
    }
    
    const admin_id = req.user.admin_id;
    
    // Get customers for this admin
    const [customers] = await pool.query(
      'SELECT customer_id as id, name, phone, language, "customer" as user_type FROM customers WHERE admin_id = ?',
      [admin_id]
    );
    
    // Get admin info
    const [admins] = await pool.query(
      'SELECT admin_id as id, name, email, language, "admin" as user_type FROM admins WHERE admin_id = ?',
      [admin_id]
    );
    
    // Combine both results
    const allUsers = [...customers, ...admins].map(user => {
      const languageCode = user.language || 2; // Default to 2 (English) if null
      const languageName = languageCode === 1 ? 'Hindi' : 'English';
      
      return {
        ...user,
        language_code: languageCode,
        language_name: languageName
      };
    });
    
    return res.status(200).json({
      success: true,
      count: allUsers.length,
      data: allUsers
    });
  } catch (err) {
    console.error('❌ Error fetching users language data:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
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
// Bulk WhatsApp messaging API
// ✅ View all areas for a specific admin by email
app.get("/areas", async (req, res) => {
  const { admin_email } = req.query;

  if (!admin_email) {
    return res.status(400).json({ success: false, error: "Admin email is required" });
  }

  try {
    let admin_id;
    
    // Check if admin_email is actually an ID (assuming IDs are numeric)
    if (/^\d+$/.test(admin_email)) {
      // It's a numeric ID, use it directly
      admin_id = admin_email;
    } else {
      // It's an email, look up the admin_id
      const [admin] = await pool.query("SELECT admin_id FROM admins WHERE email = ?", [admin_email]);

      if (admin.length === 0) {
        return res.status(404).json({ success: false, error: "Admin not found" });
      }

      admin_id = admin[0].admin_id;
    }

    // Fetch all areas belonging to the admin
    const query = `
      SELECT area_id, area_name, priority, timings, morning_priority, evening_priority 
      FROM areas 
      WHERE admin_id = ? 
      ORDER BY priority ASC, area_name ASC`;
    const [areas] = await pool.query(query, [admin_id]);

    // Transform and group data by morning and evening
    const formattedResponse = {
      morning: [],
      evening: []
    };

    areas.forEach(area => {
      const areaData = {
        area_id: area.area_id,
        area_name: area.area_name,
        priority: area.priority,
        timings: area.timings,
        morning_priority: area.morning_priority,
        evening_priority: area.evening_priority
      };

      // Add to morning group if timing is 1 (morning) or 3 (both)
      if (area.timings === 1 || area.timings === 3) {
        formattedResponse.morning.push(areaData);
      }

      // Add to evening group if timing is 2 (evening) or 3 (both)
      if (area.timings === 2 || area.timings === 3) {
        formattedResponse.evening.push(areaData);
      }
    });

    // Sort morning areas by morning_priority
    formattedResponse.morning.sort((a, b) => 
      (a.morning_priority || Infinity) - (b.morning_priority || Infinity)
    );

    // Sort evening areas by evening_priority
    formattedResponse.evening.sort((a, b) => 
      (a.evening_priority || Infinity) - (b.evening_priority || Infinity)
    );

    res.json(formattedResponse);
  } catch (error) {
    console.error("Error fetching areas:", error);
    res.status(500).json({ success: false, error: "Database error" });
  }
});



// ✅ Add a new area
app.post("/areas", async (req, res) => {
  const { 
    area_name, 
    admin_id, 
    priority, 
    timings,
    morning_priority, 
    evening_priority 
  } = req.body;

  // Validate required fields
  if (!area_name || !admin_id) {
    return res.status(400).json({ success: false, error: "Area name and admin ID are required" });
  }

  // Validate timings value if provided
  if (timings !== undefined && ![1, 2, 3].includes(Number(timings))) {
    return res.status(400).json({ 
      success: false, 
      error: "Timings must be 1 (morning), 2 (evening), or 3 (both)" 
    });
  }

  // Start a transaction to ensure data consistency
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // Verify admin exists
    const [adminResult] = await connection.query(
      "SELECT admin_id FROM admins WHERE admin_id = ?", 
      [admin_id]
    );
    
    if (adminResult.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "Admin not found" });
    }
    
    // Get the highest current priority for this admin if not specified
    let newPriority = priority;
    if (newPriority === undefined) {
      const [priorityResult] = await connection.query(
        "SELECT MAX(priority) as max_priority FROM areas WHERE admin_id = ?",
        [admin_id]
      );
      newPriority = (priorityResult[0].max_priority || 0) + 1;
    } else {
      // If priority is specified, shift existing priorities to make room
      await connection.query(
        "UPDATE areas SET priority = priority + 1 WHERE admin_id = ? AND priority >= ?",
        [admin_id, newPriority]
      );
    }
    
    // Handle morning_priority
    let newMorningPriority = morning_priority;
    if ((timings === 1 || timings === 3) && newMorningPriority === undefined) {
      // Get the highest current morning priority for this admin
      const [morningResult] = await connection.query(
        "SELECT MAX(morning_priority) as max_priority FROM areas WHERE admin_id = ?",
        [admin_id]
      );
      newMorningPriority = (morningResult[0].max_priority || 0) + 1;
    } else if (newMorningPriority !== undefined) {
      // Shift existing morning priorities
      await connection.query(
        "UPDATE areas SET morning_priority = morning_priority + 1 WHERE admin_id = ? AND morning_priority >= ?",
        [admin_id, newMorningPriority]
      );
    }
    
    // Handle evening_priority
    let newEveningPriority = evening_priority;
    if ((timings === 2 || timings === 3) && newEveningPriority === undefined) {
      // Get the highest current evening priority for this admin
      const [eveningResult] = await connection.query(
        "SELECT MAX(evening_priority) as max_priority FROM areas WHERE admin_id = ?",
        [admin_id]
      );
      newEveningPriority = (eveningResult[0].max_priority || 0) + 1;
    } else if (newEveningPriority !== undefined) {
      // Shift existing evening priorities
      await connection.query(
        "UPDATE areas SET evening_priority = evening_priority + 1 WHERE admin_id = ? AND evening_priority >= ?",
        [admin_id, newEveningPriority]
      );
    }
    
    // Insert the new area
    const [result] = await connection.query(
      `INSERT INTO areas 
      (area_name, admin_id, priority, timings, morning_priority, evening_priority) 
      VALUES (?, ?, ?, ?, ?, ?)`,
      [area_name, admin_id, newPriority, timings, newMorningPriority, newEveningPriority]
    );
    
    await connection.commit();
    
    res.status(201).json({
      success: true,
      message: "Area added successfully",
      area_id: result.insertId,
      area_name,
      admin_id,
      priority: newPriority,
      timings,
      morning_priority: newMorningPriority,
      evening_priority: newEveningPriority
    });
    
  } catch (error) {
    await connection.rollback();
    console.error("Error adding area:", error);
    res.status(500).json({ success: false, error: "Database error" });
  } finally {
    connection.release();
  }
});

// ✅ Update an existing area
app.put("/areas/:area_id", async (req, res) => {
  const { area_id } = req.params;
  const { 
    area_name, 
    admin_id, 
    priority, 
    timings, 
    morning_priority, 
    evening_priority 
  } = req.body;

  // Validate timings value if provided
  if (timings !== undefined && ![1, 2, 3].includes(Number(timings))) {
    return res.status(400).json({ 
      success: false, 
      error: "Timings must be 1 (morning), 2 (evening), or 3 (both)" 
    });
  }

  // Start a transaction to ensure data consistency
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    // First, get the current values of the area being updated
    const [currentArea] = await connection.query(
      "SELECT admin_id, priority, timings, morning_priority, evening_priority FROM areas WHERE area_id = ?",
      [area_id]
    );
    
    if (currentArea.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, error: "Area not found" });
    }
    
    const currentAdminId = currentArea[0].admin_id;
    const currentPriority = currentArea[0].priority;
    const currentTimings = currentArea[0].timings;
    const currentMorningPriority = currentArea[0].morning_priority;
    const currentEveningPriority = currentArea[0].evening_priority;
    
    // Verify new admin_id if provided
    if (admin_id !== undefined && admin_id !== currentAdminId) {
      const [adminResult] = await connection.query(
        "SELECT admin_id FROM admins WHERE admin_id = ?", 
        [admin_id]
      );
      
      if (adminResult.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, error: "Admin not found" });
      }
    }
    
    // Handle the general priority changes
    if (priority !== undefined && priority !== currentPriority) {
      const targetAdminId = admin_id || currentAdminId;
      
      // If moving to a higher priority (lower number), shift others down
      if (priority < currentPriority) {
        await connection.query(
          "UPDATE areas SET priority = priority + 1 WHERE admin_id = ? AND priority >= ? AND priority < ? AND area_id != ?",
          [targetAdminId, priority, currentPriority, area_id]
        );
      } 
      // If moving to a lower priority (higher number), shift others up
      else if (priority > currentPriority) {
        await connection.query(
          "UPDATE areas SET priority = priority - 1 WHERE admin_id = ? AND priority > ? AND priority <= ? AND area_id != ?",
          [targetAdminId, currentPriority, priority, area_id]
        );
      }
    }
    
    // Handle morning priority changes
    if (morning_priority !== undefined && morning_priority !== currentMorningPriority) {
      const targetAdminId = admin_id || currentAdminId;
      
      // Handle reorganizing morning priorities
      if (morning_priority < currentMorningPriority) {
        await connection.query(
          "UPDATE areas SET morning_priority = morning_priority + 1 WHERE admin_id = ? AND morning_priority >= ? AND morning_priority < ? AND area_id != ?",
          [targetAdminId, morning_priority, currentMorningPriority, area_id]
        );
      } else if (morning_priority > currentMorningPriority) {
        await connection.query(
          "UPDATE areas SET morning_priority = morning_priority - 1 WHERE admin_id = ? AND morning_priority > ? AND morning_priority <= ? AND area_id != ?",
          [targetAdminId, currentMorningPriority, morning_priority, area_id]
        );
      }
    }
    
    // Handle evening priority changes
    if (evening_priority !== undefined && evening_priority !== currentEveningPriority) {
      const targetAdminId = admin_id || currentAdminId;
      
      // Handle reorganizing evening priorities
      if (evening_priority < currentEveningPriority) {
        await connection.query(
          "UPDATE areas SET evening_priority = evening_priority + 1 WHERE admin_id = ? AND evening_priority >= ? AND evening_priority < ? AND area_id != ?",
          [targetAdminId, evening_priority, currentEveningPriority, area_id]
        );
      } else if (evening_priority > currentEveningPriority) {
        await connection.query(
          "UPDATE areas SET evening_priority = evening_priority - 1 WHERE admin_id = ? AND evening_priority > ? AND evening_priority <= ? AND area_id != ?",
          [targetAdminId, currentEveningPriority, evening_priority, area_id]
        );
      }
    }
    
    // Handle timing changes
    let newMorningPriority = morning_priority;
    let newEveningPriority = evening_priority;
    
    if (timings !== undefined && timings !== currentTimings) {
      const targetAdminId = admin_id || currentAdminId;
      
      // If adding morning timing (1 or 3) and no morning_priority specified
      if ((timings === 1 || timings === 3) && (currentTimings === 2 || currentTimings === null) && newMorningPriority === undefined) {
        // Get the highest current morning priority for this admin
        const [morningResult] = await connection.query(
          "SELECT MAX(morning_priority) as max_priority FROM areas WHERE admin_id = ?",
          [targetAdminId]
        );
        newMorningPriority = (morningResult[0].max_priority || 0) + 1;
      }
      
      // If adding evening timing (2 or 3) and no evening_priority specified
      if ((timings === 2 || timings === 3) && (currentTimings === 1 || currentTimings === null) && newEveningPriority === undefined) {
        // Get the highest current evening priority for this admin
        const [eveningResult] = await connection.query(
          "SELECT MAX(evening_priority) as max_priority FROM areas WHERE admin_id = ?",
          [targetAdminId]
        );
        newEveningPriority = (eveningResult[0].max_priority || 0) + 1;
      }
      
      // If removing morning timing
      if ((timings === 2) && (currentTimings === 1 || currentTimings === 3) && currentMorningPriority !== null) {
        // Reorder remaining morning priorities
        await connection.query(
          "UPDATE areas SET morning_priority = morning_priority - 1 WHERE admin_id = ? AND morning_priority > ? AND area_id != ?",
          [targetAdminId, currentMorningPriority, area_id]
        );
        newMorningPriority = null;
      }
      
      // If removing evening timing
      if ((timings === 1) && (currentTimings === 2 || currentTimings === 3) && currentEveningPriority !== null) {
        // Reorder remaining evening priorities
        await connection.query(
          "UPDATE areas SET evening_priority = evening_priority - 1 WHERE admin_id = ? AND evening_priority > ? AND area_id != ?",
          [targetAdminId, currentEveningPriority, area_id]
        );
        newEveningPriority = null;
      }
    }
    
    // Update the current area with new values
    const updateFields = [];
    const updateValues = [];
    
    if (area_name !== undefined) {
      updateFields.push("area_name = ?");
      updateValues.push(area_name);
    }
    
    if (admin_id !== undefined) {
      updateFields.push("admin_id = ?");
      updateValues.push(admin_id);
    }
    
    if (priority !== undefined) {
      updateFields.push("priority = ?");
      updateValues.push(priority);
    }
    
    if (timings !== undefined) {
      updateFields.push("timings = ?");
      updateValues.push(timings);
    }
    
    if (newMorningPriority !== undefined) {
      updateFields.push("morning_priority = ?");
      updateValues.push(newMorningPriority);
    }
    
    if (newEveningPriority !== undefined) {
      updateFields.push("evening_priority = ?");
      updateValues.push(newEveningPriority);
    }
    
    // Add area_id at the end for the WHERE clause
    updateValues.push(area_id);
    
    if (updateFields.length > 0) {
      const [result] = await connection.query(
        `UPDATE areas SET ${updateFields.join(", ")} WHERE area_id = ?`,
        updateValues
      );
    }
    
    await connection.commit();
    
    // Fetch the updated area to return in response
    const [updatedArea] = await pool.query(
      "SELECT * FROM areas WHERE area_id = ?",
      [area_id]
    );
    
    res.json({
      success: true,
      message: "Area updated successfully",
      area: updatedArea[0]
    });
    
  } catch (error) {
    await connection.rollback();
    console.error("Error updating area:", error);
    res.status(500).json({ success: false, error: "Database error" });
  } finally {
    connection.release();
  }
});






// Bulk update priorities endpoint - now supporting all priority types
app.put("/areas/bulk-update-priorities", async (req, res) => {
  const { areas } = req.body;
  
  if (!Array.isArray(areas)) {
    return res.status(400).json({ error: "Areas must be an array" });
  }
  
  console.log("Received area update request:", JSON.stringify(areas));
  
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    
    // Get the admin_id to use for all operations
    const [adminResult] = await connection.query(
      "SELECT admin_id FROM areas WHERE area_id = ? LIMIT 1",
      [areas[0].area_id]
    );
    
    if (adminResult.length === 0) {
      throw new Error("Could not determine admin_id");
    }
    
    const admin_id = adminResult[0].admin_id;
    
    // First, temporarily set all priorities to NULL to avoid unique constraint issues
    await connection.query(
      "UPDATE areas SET priority = NULL, morning_priority = NULL, evening_priority = NULL WHERE admin_id = ?",
      [admin_id]
    );
    
    // Now update each area with its new priorities
    const updatePromises = areas.map(area => {
      // Build dynamic query based on what fields were provided
      const fields = [];
      const values = [];
      
      if (area.priority !== undefined) {
        fields.push("priority = ?");
        values.push(area.priority);
      }
      
      if (area.timings !== undefined) {
        fields.push("timings = ?");
        values.push(area.timings);
      }
      
      if (area.morning_priority !== undefined) {
        fields.push("morning_priority = ?");
        values.push(area.morning_priority);
      }
      
      if (area.evening_priority !== undefined) {
        fields.push("evening_priority = ?");
        values.push(area.evening_priority);
      }
      
      // Add area_id for WHERE clause
      values.push(area.area_id);
      
      return connection.query(
        `UPDATE areas SET ${fields.join(", ")} WHERE area_id = ?`,
        values
      );
    });
    
    await Promise.all(updatePromises);
    
    await connection.commit();
    res.json({
      message: "Area priorities updated successfully",
      updatedCount: areas.length
    });
  } catch (error) {
    await connection.rollback();
    console.error("Error updating area priorities:", error);
    res.status(500).json({
      error: "Database error",
      details: error.message
    });
  } finally {
    connection.release();
  }
});
app.get('/orders', verifyToken, async (req, res) => {
  try {
    // Optional query parameters for filtering
    const { customerId, status, startDate, endDate, limit, offset } = req.query;
    
    // Start building the query
    let query = `
      SELECT 
        o.order_id,
        o.customer_id,
        c.name as customer_name,
        c.address,
        c.phone,
        o.order_date,
        o.quantity,
        o.price,
        ROUND(o.quantity * o.price, 2) AS order_amount,
        COALESCE(o.paid_amount, 0) AS paid_amount,
        ROUND((o.quantity * o.price) - COALESCE(o.paid_amount, 0), 2) AS remaining_amount,
        o.payment_status,
        o.admin_id
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE 1=1
    `;
    
    // Initialize params array
    const queryParams = [];
    
    // Apply filters if provided
    if (customerId) {
      query += ` AND o.customer_id = ?`;
      queryParams.push(customerId);
    }
    
    if (status) {
      query += ` AND o.payment_status = ?`;
      queryParams.push(status);
    }
    
    if (startDate) {
      query += ` AND o.order_date >= ?`;
      queryParams.push(startDate);
    }
    
    if (endDate) {
      query += ` AND o.order_date <= ?`;
      queryParams.push(endDate);
    }
    
    // Add ordering
    query += ` ORDER BY o.order_date DESC`;
    
    // Add pagination if provided
    if (limit) {
      query += ` LIMIT ?`;
      queryParams.push(Number(limit));
      
      if (offset) {
        query += ` OFFSET ?`;
        queryParams.push(Number(offset));
      }
    }
    
    // Execute the query
    const [orders] = await pool.query(query, queryParams);
    
    // Calculate summary information
    const totalOrderAmount = orders.reduce((sum, order) => sum + Number(order.order_amount), 0);
    const totalPaidAmount = orders.reduce((sum, order) => sum + Number(order.paid_amount), 0);
    const totalRemainingAmount = orders.reduce((sum, order) => sum + Number(order.remaining_amount), 0);
    
    // Return the results
    res.status(200).json({
      success: true,
      total_order_amount: totalOrderAmount,
      total_paid_amount: totalPaidAmount,
      total_remaining_amount: totalRemainingAmount,
      order_count: orders.length,
      orders: orders
    });
    
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
});


app.get('/customers/:customerId/orders', verifyToken, async (req, res) => {
  try {
    // Get customer ID from URL parameter
    const { customerId } = req.params;
    
    // Optional query parameters for additional filtering
    const { status, startDate, endDate, limit, offset } = req.query;
    
    // Build the query - similar to your original but always filtering by customer ID
    let query = `
      SELECT 
        o.order_id,
        o.customer_id,
        c.name as customer_name,
        c.address,
        c.phone,
        o.order_date,
        o.quantity,
        o.price,
        ROUND(o.quantity * o.price, 2) AS order_amount,
        COALESCE(o.paid_amount, 0) AS paid_amount,
        ROUND((o.quantity * o.price) - COALESCE(o.paid_amount, 0), 2) AS remaining_amount,
        o.payment_status,
        o.admin_id
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE o.customer_id = ?
    `;
    
    // Initialize params array with customerId
    const queryParams = [customerId];
    
    // Apply additional filters if provided
    if (status) {
      query += ` AND o.payment_status = ?`;
      queryParams.push(status);
    }
    
    if (startDate) {
      query += ` AND o.order_date >= ?`;
      queryParams.push(startDate);
    }
    
    if (endDate) {
      query += ` AND o.order_date <= ?`;
      queryParams.push(endDate);
    }
    
    // Add ordering
    query += ` ORDER BY o.order_date DESC`;
    
    // Add pagination if provided
    if (limit) {
      query += ` LIMIT ?`;
      queryParams.push(Number(limit));
      
      if (offset) {
        query += ` OFFSET ?`;
        queryParams.push(Number(offset));
      }
    }
    
    // Execute the query
    const [orders] = await pool.query(query, queryParams);
    
    // Get customer info
    const [customerInfo] = await pool.query(
      'SELECT customer_id, name, address, phone FROM customers WHERE customer_id = ?',
      [customerId]
    );
    
    // Calculate summary information
    const totalOrderAmount = orders.reduce((sum, order) => sum + Number(order.order_amount), 0);
    const totalPaidAmount = orders.reduce((sum, order) => sum + Number(order.paid_amount), 0);
    const totalRemainingAmount = orders.reduce((sum, order) => sum + Number(order.remaining_amount), 0);
    
    // Return the results
    res.status(200).json({
      success: true,
      customer: customerInfo[0] || null,
      total_order_amount: totalOrderAmount,
      total_paid_amount: totalPaidAmount,
      total_remaining_amount: totalRemainingAmount,
      order_count: orders.length,
      orders: orders
    });
    
  } catch (error) {
    console.error('Error fetching customer orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer orders',
      error: error.message
    });
  }
});

app.post('/daily-entry', verifyToken, async (req, res) => {
  const entries = req.body.entries; // Array of daily entries
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    for (const entry of entries) {
      const { customer_id, quantity, price, milk_type } = entry;

      // Validate milk_type (but allow quantity to be 0)
      if (!milk_type || !['cow', 'buffalo'].includes(milk_type)) {
        throw new Error(`Invalid or missing milk_type for customer_id: ${customer_id}. Must be 'cow' or 'buffalo'.`);
      }

      const total_amount = quantity * price; // Calculate total amount

      const query = `
        INSERT INTO orders (
          customer_id, 
          quantity, 
          price, 
          total_amount, 
          order_date, 
          delivery_date,
          payment_status, 
          delivery_status,
          milk_type
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(query, [
        customer_id, 
        quantity, 
        price, 
        total_amount, 
        new Date(),  // NOW()
        new Date(),  // NOW()
        'Pending', 
        'pending', 
        milk_type
      ]);
    }

    await connection.commit();
    res.status(200).json({ 
      success: true,
      message: 'Daily entries recorded successfully' 
    });
  } catch (error) {
    await connection.rollback();
    console.error('Error recording daily entries:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to record daily entries',
      error: error.message 
    });
  } finally {
    connection.release();
  }
});




// Admin Profile API - Gets current admin's information from their token
app.get('/admin/profile', verifyToken, async (req, res) => {
  // The verifyToken middleware already decoded the token and put the info in req.user
  
  try {
    // We could fetch fresh data from the database
    const [rows] = await pool.query('SELECT admin_id, name, email FROM admins WHERE admin_id = ?', [req.user.admin_id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Admin not found' 
      });
    }
    
    // Return the admin information
    return res.status(200).json({
      success: true,
      admin: {
        admin_id: rows[0].admin_id,
        name: rows[0].name,
        email: rows[0].email
      }
    });
  } catch (err) {
    console.error('❌ Error fetching admin profile:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error' 
    });
  }
});

app.get('/admin/customer-list', verifyToken, async (req, res) => {
  // Ensure the user is authenticated as an admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      message: 'Access denied. Admin privileges required.' 
    });
  }
  
  try {
    // Get admin_id from the authenticated user's token
    const { admin_id } = req.user;
    
    // Query to fetch all customers associated with this admin
    const [rows] = await pool.query(
      'SELECT customer_id, name, phone, address FROM customers WHERE admin_id = ?',
      [admin_id]
    );
    
    // Return the results
    return res.status(200).json({
      success: true,
      count: rows.length,
      customers: rows
    });
  } catch (err) {
    console.error('❌ Error fetching customers:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  }
});
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
    const [originalPaymentResult] = await connection.query(
      'SELECT amount_paid, payment_date, customer_id FROM payments WHERE payment_id = ?',
      [paymentId]
    );

    if (originalPaymentResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    const original = originalPaymentResult[0];
    const originalCustomerId = original.customer_id;
    const originalAmount = Number(original.amount_paid);
    const originalDate = new Date(original.payment_date);
    const newAmount = Number(amount_paid);
    const newDate = new Date(payment_date);
    const isAmountChanged = originalAmount !== newAmount;
    const isDateChanged = originalDate.getTime() !== newDate.getTime();
    const isCustomerChanged = originalCustomerId !== customer_id;

    // Handle different scenarios
    if (isCustomerChanged) {
      // This is the most complex case - we need to roll back from one customer and apply to another
      
      // 1. Roll back the original customer's payment
      await rollbackPayment(connection, originalCustomerId, originalAmount, originalDate);
      
      // 2. Apply the new payment to the new customer
      await applyPayment(connection, customer_id, newAmount, newDate);
    } 
    else if (isAmountChanged || isDateChanged) {
      // Roll back the original payment and reapply with new details
      await rollbackPayment(connection, originalCustomerId, originalAmount, originalDate);
      await applyPayment(connection, originalCustomerId, newAmount, newDate);
    }

    // Update the payment record itself
    await connection.query(
      'UPDATE payments SET amount_paid = ?, payment_date = ?, customer_id = ? WHERE payment_id = ?',
      [amount_paid, payment_date, customer_id, paymentId]
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

// Helper function to roll back a payment's effects
async function rollbackPayment(connection, customerId, amount, paymentDate) {
  // 1. Get all orders that were affected by this payment
  const [affectedOrders] = await connection.query(
    `SELECT order_id, quantity, price, paid_amount, payment_status 
     FROM orders 
     WHERE customer_id = ? 
     AND order_date <= ?
     AND payment_status IN ('Paid', 'Partially Paid')
     ORDER BY order_date DESC`,  // Process newest orders first when rolling back
    [customerId, paymentDate]
  );
  
  // 2. Calculate how much to roll back
  let amountToRollback = amount;
  let ordersToReset = [];
  
  // Find which orders were affected by this payment
  for (const order of affectedOrders) {
    const paidAmount = Number(order.paid_amount);
    
    if (paidAmount > 0 && amountToRollback > 0) {
      const rollbackAmount = Math.min(paidAmount, amountToRollback);
      amountToRollback -= rollbackAmount;
      
      // Store this order for reset
      ordersToReset.push({
        order_id: order.order_id,
        original_paid: paidAmount,
        rollback_amount: rollbackAmount,
        new_paid: paidAmount - rollbackAmount,
        price: Number(order.price),
        quantity: Number(order.quantity)
      });
      
      if (amountToRollback <= 0) break;
    }
  }
  
  // 3. Reset the affected orders
  for (const order of ordersToReset) {
    const orderTotal = order.price * order.quantity;
    let newStatus = 'Pending';
    
    if (order.new_paid > 0) {
      newStatus = order.new_paid >= orderTotal ? 'Paid' : 'Partially Paid';
    }
    
    await connection.query(
      'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
      [newStatus, order.new_paid, order.order_id]
    );
  }
  
  // 4. Update advance amount if necessary
  const [advanceRows] = await connection.query(
    'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
    [customerId]
  );
  
  if (advanceRows.length > 0) {
    const currentAdvance = Number(advanceRows[0].advance_amount);
    // If this was an advance payment, we need to reduce the advance
    if (amountToRollback > 0) {
      const newAdvance = Math.max(0, currentAdvance - amountToRollback);
      
      if (newAdvance > 0) {
        await connection.query(
          'UPDATE customer_advances SET advance_amount = ?, updated_date = NOW() WHERE customer_id = ?',
          [newAdvance, customerId]
        );
      } else {
        // Delete the advance record if zero
        await connection.query(
          'DELETE FROM customer_advances WHERE customer_id = ?',
          [customerId]
        );
      }
    }
  }
}

// Helper function to apply a payment
async function applyPayment(connection, customerId, amount, paymentDate) {
  // 1. Get unpaid orders for this customer
  const [unpaidOrders] = await connection.query(
    `SELECT order_id, quantity, price, paid_amount, payment_status 
     FROM orders 
     WHERE customer_id = ? 
     AND order_date <= ?
     AND payment_status IN ('Pending', 'Partially Paid')
     ORDER BY order_date ASC`,  // Process oldest orders first when applying payment
    [customerId, paymentDate]
  );
  
  // 2. Apply payment to orders
  let remainingAmount = amount;
  
  for (const order of unpaidOrders) {
    if (remainingAmount <= 0) break;
    
    const orderTotal = Number(order.quantity) * Number(order.price);
    const currentlyPaid = Number(order.paid_amount) || 0;
    const stillDue = orderTotal - currentlyPaid;
    
    if (stillDue > 0) {
      const paymentToApply = Math.min(remainingAmount, stillDue);
      const newPaidAmount = currentlyPaid + paymentToApply;
      const newStatus = newPaidAmount >= orderTotal ? 'Paid' : 'Partially Paid';
      
      await connection.query(
        'UPDATE orders SET payment_status = ?, paid_amount = ? WHERE order_id = ?',
        [newStatus, newPaidAmount, order.order_id]
      );
      
      remainingAmount -= paymentToApply;
    }
  }
  
  // 3. Handle any remaining amount as an advance
  if (remainingAmount > 0) {
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customerId]
    );
    
    if (advanceRows.length > 0) {
      const currentAdvance = Number(advanceRows[0].advance_amount);
      await connection.query(
        'UPDATE customer_advances SET advance_amount = ?, updated_date = NOW() WHERE customer_id = ?',
        [currentAdvance + remainingAmount, customerId]
      );
    } else {
      await connection.query(
        'INSERT INTO customer_advances (customer_id, advance_amount, created_date, updated_date) VALUES (?, ?, NOW(), NOW())',
        [customerId, remainingAmount]
      );
    }
  }
}


// Fetch pending orders for a specific customer
app.get('/pending-orders/:customerId', verifyToken, async (req, res) => {
  try {
    const { customerId } = req.params;
    
    const query = `
  SELECT order_id, total_amount AS order_amount, paid_amount 
  FROM orders 
  WHERE customer_id = ? AND payment_status != 'paid'
  LIMIT 25;

    `;
    
    const [rows] = await pool.query(query, [customerId]);
    res.json({ success: true, pendingOrders: rows });
    
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({ success: false, message: 'Error fetching pending orders' });
  }
});


// Check if customer has pending orders
app.get('/admin/customer/:customerId/pending-orders', verifyToken, async (req, res) => {
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    const { customerId } = req.params;
    
    // Check if customer has pending orders
    const [pendingOrders] = await pool.query(
      "SELECT COUNT(*) as count FROM orders WHERE customer_id = ? AND payment_status IN ('Pending', 'Partially Paid')",
      [customerId]
    );
    
    return res.status(200).json({
      success: true,
      hasPendingOrders: pendingOrders[0].count > 0,
      pendingOrdersCount: pendingOrders[0].count
    });
    
  } catch (err) {
    console.error('❌ Error checking pending orders:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  }
});

app.get('/customer/orders', async (req, res) => {
  try {
    // Get customer ID from query parameter
    const { customerId } = req.query;
    
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }
    
    // Query to get all orders for the specified customer
    const query = `
      SELECT 
        o.order_id,
        o.customer_id,
        c.name as customer_name,
        o.order_date,
        o.quantity,
        o.price,
        ROUND(o.quantity * o.price, 2) AS order_amount,
        COALESCE(o.paid_amount, 0) AS paid_amount,
        ROUND((o.quantity * o.price) - COALESCE(o.paid_amount, 0), 2) AS remaining_amount,
        o.payment_status
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE o.customer_id = ?
      ORDER BY o.order_date DESC
    `;
    
    const [orders] = await pool.query(query, [customerId]);
    
    // Get customer information
    const [customerRows] = await pool.query(
      'SELECT customer_id, name, address, phone FROM customers WHERE customer_id = ?',
      [customerId]
    );
    
    if (customerRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    const customer = customerRows[0];
    
    // Calculate totals
    const totalOrderAmount = orders.reduce((sum, order) => sum + Number(order.order_amount), 0);
    const totalPaidAmount = orders.reduce((sum, order) => sum + Number(order.paid_amount), 0);
    const totalRemainingAmount = orders.reduce((sum, order) => sum + Number(order.remaining_amount), 0);
    
    // Get customer advance
    const [advanceRows] = await pool.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customerId]
    );
    
    const advanceAmount = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    return res.status(200).json({
      success: true,
      customer,
      total_order_amount: totalOrderAmount,
      total_paid_amount: totalPaidAmount,
      total_remaining_amount: totalRemainingAmount,
      advance_amount: advanceAmount,
      order_count: orders.length,
      orders
    });
    
  } catch (err) {
    console.error('❌ Error fetching customer orders:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Database error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
  }
});

app.get('/customer/order-summary', async (req, res) => {
  try {
    // Get customer ID from query parameter instead of auth token
    const { customerId, period = 'month' } = req.query; // 'day', 'week', 'month', 'year'
    
    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }
    
    let dateFormat;
    switch (period) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%x-W%v'; // ISO week format
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'year':
        dateFormat = '%Y';
        break;
      default:
        dateFormat = '%Y-%m';
    }
    
    const query = `
      SELECT 
        DATE_FORMAT(order_date, ?) AS period,
        SUM(quantity) AS total_quantity,
        ROUND(AVG(price), 2) AS average_price,
        ROUND(SUM(quantity * price), 2) AS total_value,
        ROUND(SUM(COALESCE(paid_amount, 0)), 2) AS total_paid,
        ROUND(SUM(quantity * price) - SUM(COALESCE(paid_amount, 0)), 2) AS total_pending
      FROM orders
      WHERE customer_id = ?
      GROUP BY DATE_FORMAT(order_date, ?)
      ORDER BY MIN(order_date) DESC
      LIMIT 12
    `;
    
    const [summary] = await pool.query(query, [dateFormat, customerId, dateFormat]);
    
    // Get customer advance
    const [advanceRows] = await pool.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customerId]
    );
    
    const advanceAmount = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    return res.status(200).json({
      success: true,
      summary: summary,
      customer_advance: advanceAmount
    });
     
  } catch (err) {
    console.error('❌ Error fetching customer order summary:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Database error',
      error: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred'
    });
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

// Past Orders API for viewing and editing customer orders

// Get customer orders history
app.get('/admin/customer-orders/:customerId', verifyToken, async (req, res) => {
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    const { customerId } = req.params;
    const { startDate, endDate, limit = 50, page = 1 } = req.query;
    
    // Start building the query with parameters
    let query = `
      SELECT 
        o.order_id,
        o.customer_id,
        c.name AS customer_name,
        o.quantity,
        o.price,
        o.order_date,
        o.payment_status,
        o.paid_amount,
        ROUND(o.quantity * o.price, 2) AS total_amount,
        ROUND(o.quantity * o.price - COALESCE(o.paid_amount, 0), 2) AS pending_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE o.customer_id = ?
    `;
    
    const queryParams = [customerId];
    
    // Add date filters if provided
    if (startDate) {
      query += ` AND o.order_date >= ?`;
      queryParams.push(startDate);
    }
    
    if (endDate) {
      query += ` AND o.order_date <= ?`;
      queryParams.push(endDate);
    }
    
    // Add sorting and pagination
    const offset = (page - 1) * limit;
    query += ` ORDER BY o.order_date DESC LIMIT ? OFFSET ?`;
    queryParams.push(parseInt(limit), parseInt(offset));
    
    // Execute query
    const [orders] = await pool.query(query, queryParams);
    
    // Get total count for pagination
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM orders WHERE customer_id = ?
       ${startDate ? ' AND order_date >= ?' : ''}
       ${endDate ? ' AND order_date <= ?' : ''}`,
      queryParams.slice(0, queryParams.length - 2)
    );
    
    const totalOrders = countResult[0].total;
    const totalPages = Math.ceil(totalOrders / limit);
    
    return res.status(200).json({
      success: true,
      orders: orders,
      pagination: {
        current_page: parseInt(page),
        total_pages: totalPages,
        total_records: totalOrders,
        per_page: parseInt(limit)
      }
    });
    
  } catch (err) {
    console.error('❌ Error fetching customer orders:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  }
});

// Get single order details
app.get('/admin/order/:orderId', verifyToken, async (req, res) => {
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    const { orderId } = req.params;
    
    const query = `
      SELECT 
        o.order_id,
        o.customer_id,
        c.name AS customer_name,
        c.address,
        c.phone,
        o.quantity,
        o.price,
        o.order_date,
        o.payment_status,
        o.paid_amount,
        ROUND(o.quantity * o.price, 2) AS total_amount,
        ROUND(o.quantity * o.price - COALESCE(o.paid_amount, 0), 2) AS pending_amount,
        o.creation_date,
        o.last_modified_date
      FROM orders o
      JOIN customers c ON o.customer_id = c.customer_id
      WHERE o.order_id = ?
    `;
    
    const [orders] = await pool.query(query, [orderId]);
    
    if (orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }
    
    return res.status(200).json({
      success: true,
      order: orders[0]
    });
    
  } catch (err) {
    console.error('❌ Error fetching order details:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  }
});

// Update existing order
app.put('/admin/order/:orderId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    await connection.beginTransaction();
    
    const { orderId } = req.params;
    const { quantity, price, order_date, payment_status } = req.body;
    
    // Validate required fields
    if (!quantity || !price || !order_date) {
      return res.status(400).json({
        success: false,
        message: 'Quantity, price, and order date are required'
      });
    }
    
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
    
    // Handle payment status adjustments
    if (original.payment_status !== 'Pending') {
      // If the order was paid or partially paid, need special handling
      if (payment_status === 'Pending') {
        // Refund any paid amount to advance
        if (original.paid_amount > 0) {
          const [advanceRows] = await connection.query(
            'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
            [original.customer_id]
          );
          
          if (advanceRows.length > 0) {
            await connection.query(
              'UPDATE customer_advances SET advance_amount = advance_amount + ? WHERE customer_id = ?',
              [original.paid_amount, original.customer_id]
            );
          } else {
            await connection.query(
              'INSERT INTO customer_advances (customer_id, advance_amount) VALUES (?, ?)',
              [original.customer_id, original.paid_amount]
            );
          }
          
          // Update order to pending with no paid amount
          await connection.query(
            'UPDATE orders SET quantity = ?, price = ?, paid_amount = 0, payment_status = ?, order_date = ?, last_modified_date = NOW() WHERE order_id = ?',
            [quantity, price, 'Pending', order_date, orderId]
          );
        }
      } else if (newTotal !== originalTotal) {
        // If total changed and order was paid or partially paid
        const paidRatio = original.paid_amount / originalTotal;
        const newPaidAmount = Math.min(newTotal, paidRatio * newTotal);
        const newPaymentStatus = newPaidAmount >= newTotal ? 'Paid' : 'Partially Paid';
        
        // Update order with adjusted paid amount
        await connection.query(
          'UPDATE orders SET quantity = ?, price = ?, paid_amount = ?, payment_status = ?, order_date = ?, last_modified_date = NOW() WHERE order_id = ?',
          [quantity, price, newPaidAmount, newPaymentStatus, order_date, orderId]
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
        // Total didn't change, just update other fields
        await connection.query(
          'UPDATE orders SET quantity = ?, price = ?, order_date = ?, last_modified_date = NOW() WHERE order_id = ?',
          [quantity, price, order_date, orderId]
        );
      }
    } else {
      // If order was pending, simply update all values
      await connection.query(
        'UPDATE orders SET quantity = ?, price = ?, order_date = ?, last_modified_date = NOW() WHERE order_id = ?',
        [quantity, price, order_date, orderId]
      );
    }
    
    await connection.commit();
    
    res.json({
      success: true,
      message: 'Order updated successfully'
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: error.message
    });
  } finally {
    connection.release();
  }
});

// Delete customer
// Delete customer
// Delete customer
app.delete('/admin/customer/:customerId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    await connection.beginTransaction();
    
    const { customerId } = req.params;
    const { transferAdvance } = req.query;
    
    // Verify customer belongs to this admin
    const [customerCheck] = await connection.query(
      'SELECT customer_id, admin_id FROM customers WHERE customer_id = ?',
      [customerId]
    );
    
    if (customerCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    if (customerCheck[0].admin_id !== req.user.admin_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this customer'
      });
    }
    
    // Check if customer has advance balance - only for information purposes
    const [advanceCheck] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ? AND advance_amount > 0',
      [customerId]
    );
    
    // Delete related records in proper order to maintain referential integrity
    // 1. Delete any payment records
    await connection.query('DELETE FROM payments WHERE customer_id = ?', [customerId]);
    
    // 2. Delete any advances (regardless of transferAdvance parameter now)
    await connection.query('DELETE FROM customer_advances WHERE customer_id = ?', [customerId]);
    
    // 3. Delete any orders (including pending ones)
    await connection.query('DELETE FROM orders WHERE customer_id = ?', [customerId]);
    
    // 4. Finally delete the customer
    await connection.query('DELETE FROM customers WHERE customer_id = ?', [customerId]);
    
    // Remove from cache if exists
    const cacheKey = `customer:${customerId}`;
    if (customerCache.has(cacheKey)) {
      customerCache.delete(cacheKey);
    }
    
    await connection.commit();
    
    // Include information about what was deleted
    let message = 'Customer deleted successfully';
    if (advanceCheck.length > 0) {
      message += `. Note: Customer had an advance balance of ${advanceCheck[0].advance_amount} which has been cleared.`;
    }
    
    return res.status(200).json({
      success: true,
      message
    });
    
  } catch (err) {
    await connection.rollback();
    console.error('❌ Error deleting customer:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  } finally {
    connection.release();
  }
});

// Get customer order summary
app.get('/admin/customer-order-summary/:customerId', verifyToken, async (req, res) => {
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    const { customerId } = req.params;
    const { period = 'month' } = req.query; // 'day', 'week', 'month', 'year'
    
    let dateFormat;
    switch (period) {
      case 'day':
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        dateFormat = '%x-W%v'; // ISO week format
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      case 'year':
        dateFormat = '%Y';
        break;
      default:
        dateFormat = '%Y-%m';
    }
    
    const query = `
      SELECT 
        DATE_FORMAT(order_date, ?) AS period,
        SUM(quantity) AS total_quantity,
        ROUND(AVG(price), 2) AS average_price,
        ROUND(SUM(quantity * price), 2) AS total_value,
        ROUND(SUM(COALESCE(paid_amount, 0)), 2) AS total_paid,
        ROUND(SUM(quantity * price) - SUM(COALESCE(paid_amount, 0)), 2) AS total_pending
      FROM orders
      WHERE customer_id = ?
      GROUP BY DATE_FORMAT(order_date, ?)
      ORDER BY MIN(order_date) DESC
      LIMIT 12
    `;
    
    const [summary] = await pool.query(query, [dateFormat, customerId, dateFormat]);
    
    // Get customer advance
    const [advanceRows] = await pool.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customerId]
    );
    
    const advanceAmount = advanceRows.length > 0 ? Number(advanceRows[0].advance_amount) : 0;
    
    return res.status(200).json({
      success: true,
      summary: summary,
      customer_advance: advanceAmount
    });
    
  } catch (err) {
    console.error('❌ Error fetching customer order summary:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
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

app.post('/apply-advance/:customerId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    const { customerId } = req.params;
    
    // 1. Get current advance amount
    const [advanceRows] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ?',
      [customerId]
    );
    
    if (advanceRows.length === 0 || Number(advanceRows[0].advance_amount) <= 0) {
      return res.status(200).json({
        success: true,
        message: 'No advance available to apply',
        orders_affected: 0
      });
    }
    
    const availableMoney = Number(advanceRows[0].advance_amount);
    
    // 2. Get pending orders sorted by date
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
      [customerId]
    );
    
    let remainingMoney = availableMoney;
    let ordersAffected = 0;
    
    // 3. Process each pending order
    for (const order of pendingOrders) {
      const orderTotal = Number(order.order_amount);
      const alreadyPaid = Number(order.paid_amount);
      const remainingForOrder = orderTotal - alreadyPaid;
      
      if (remainingForOrder > 0) {
        if (remainingMoney >= remainingForOrder) {
          // Can pay full remaining amount
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Paid', orderTotal, order.order_id]
          );
          remainingMoney = Number((remainingMoney - remainingForOrder).toFixed(2));
          ordersAffected++;
        } else if (remainingMoney > 0) {
          // Can pay partial amount
          const newPaidAmount = alreadyPaid + remainingMoney;
          await connection.query(
            'UPDATE orders SET payment_status = ?, paid_amount = ROUND(?, 2) WHERE order_id = ?',
            ['Partially Paid', newPaidAmount, order.order_id]
          );
          ordersAffected++;
          remainingMoney = 0;
        }
      }
      
      if (remainingMoney <= 0) break;
    }
    
    // 4. Update advance amount to zero or remaining value
    await connection.query(
      'UPDATE customer_advances SET advance_amount = ROUND(?, 2), updated_date = CURRENT_TIMESTAMP WHERE customer_id = ?',
      [remainingMoney, customerId]
    );
    
    // 5. Commit transaction
    await connection.commit();
    
    // 6. Send response
    res.status(200).json({
      success: true,
      message: ordersAffected > 0 
        ? 'Advance amount applied successfully' 
        : 'No pending orders found to apply advance',
      orders_affected: ordersAffected,
      remaining_advance: remainingMoney
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Error applying advance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to apply advance',
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



// Add this route in your Express server file
app.get('/total-milk', verifyToken, async (req, res) => {
  try {
    // Extract admin_id from the verified token
    const adminId = req.user.admin_id;
    
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: 'Admin ID is required'
      });
    }

    const query = `
      WITH OrderTotals AS (
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
          c.admin_id = ? AND
          o.payment_status IN ('Pending', 'Partially Paid')
        GROUP BY 
          c.customer_id, c.name
      )
      SELECT 
        ot.*,
        COALESCE(ca.advance_amount, 0) as advance_amount,
        GREATEST(0, ot.total_pending_amount - COALESCE(ca.advance_amount, 0)) as final_pending_amount
      FROM 
        OrderTotals ot
      LEFT JOIN 
        customer_advances ca ON ot.customer_id = ca.customer_id
      HAVING 
        pending_milk_quantity > 0 OR final_pending_amount > 0
      ORDER BY 
        final_pending_amount DESC;
    `;

    const [rows] = await pool.query(query, [adminId]);

    res.json({
      success: true,
      customers: rows.map(row => ({
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        pending_milk_quantity: parseFloat(row.pending_milk_quantity),
        price_per_liter: parseFloat(row.price_per_liter),
        total_pending_amount: parseFloat(row.total_pending_amount),
        advance_amount: parseFloat(row.advance_amount),
        final_pending_amount: parseFloat(row.final_pending_amount)
      })),
      summary: {
        total_pending_milk: rows.reduce((sum, row) => sum + parseFloat(row.pending_milk_quantity), 0),
        total_pending_amount: rows.reduce((sum, row) => sum + parseFloat(row.final_pending_amount), 0),
        total_customers_with_pending: rows.length
      }
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
  // Check if user is admin
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }

  const adminId = req.user.id; // Get the admin's ID from the verified token

  try {
    // Modified query to only select customers assigned to this admin
    const [rows] = await pool.query(
      'SELECT * FROM customers WHERE admin_id = ?',
      [adminId]
    );
    res.json({ customers: rows });
  } catch (err) {
    console.error('❌ Error fetching customers:', err.message);
    res.status(500).json({ message: 'Error fetching customers' });
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

app.post('/customers', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Access denied' });
  }
  
  const {
    customerName,
    customerPassword,
    customerAddress,
    customerPhone,
    deliveryTiming, // 1=Morning, 2=Night, 3=Both
    adminId,        // Optional: Admin ID
    adminEmail,     // Optional: Admin Email
    areaId          // Required: Area ID
  } = req.body;
  
  // Input validation
  if (!customerName || !customerPassword || 
      !customerAddress || !customerPhone || !deliveryTiming || !areaId) {
    return res.status(400).json({
      success: false,
      message: 'All fields except adminId or adminEmail are required'
    });
  }
  
  // Ensure either adminId or adminEmail is provided
  if (!adminId && !adminEmail) {
    return res.status(400).json({
      success: false,
      message: 'Either adminId or adminEmail is required'
    });
  }
  
  // Validate delivery timing
  if (![1, 2, 3].includes(Number(deliveryTiming))) {
    return res.status(400).json({
      success: false,
      message: 'Invalid delivery timing. Must be 1 (Morning), 2 (Night), or 3 (Both)'
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
    let resolvedAdminId;
    
    if (adminId) {
      resolvedAdminId = adminId;
    } else if (adminEmail) {
      // If adminEmail is provided, get the corresponding adminId
      const [adminResult] = await pool.query(
        'SELECT admin_id FROM admins WHERE email = ?',
        [adminEmail]
      );
      
      if (adminResult.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid admin email'
        });
      }
      
      resolvedAdminId = adminResult[0].admin_id.toString();
    }
    
    // Verify area ID exists
    const [areaExists] = await pool.query(
      'SELECT area_id FROM areas WHERE area_id = ?',
      [areaId]
    );
    
    if (areaExists.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid area ID'
      });
    }
    
    // Insert new customer with timing, resolved admin_id, and area_id
    const query = `
      INSERT INTO customers (
        name, password, address, phone, 
        delivery_timing, admin_id, area_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    const [result] = await pool.query(query, [
      customerName,
      customerPassword,
      customerAddress,
      customerPhone,
      deliveryTiming,
      resolvedAdminId,
      areaId
    ]);
    
    const customerId = result.insertId;  // Get the customer ID that was allocated
    
    // Respond with the customer ID allocated
    res.status(201).json({
      success: true,
      message: 'Customer added successfully',
      customerId: customerId  // Include the allocated customer ID in the response
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

app.get('/customers-by-timing/:timing', verifyToken, async (req, res) => {
  try {
    // Verify admin role
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    
    const { timing } = req.params;
    const adminId = req.user.admin_id; // Get admin_id from token data
    
    if (!adminId) {
      return res.status(403).json({
        success: false,
        message: 'Invalid admin credentials'
      });
    }
    
    // Input validation
    if (!timing || !['1', '2'].includes(timing)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid timing parameter. Must be 1 (Morning) or 2 (Evening).'
      });
    }
    
    // Modified query to include customers with delivery_timing = 3 (both timings)
    const query = `
      SELECT 
        c.customer_id,
        c.name,
        c.address,
        c.phone,
        c.delivery_timing,
        c.area_id,
        a.area_name,
        COALESCE(a.priority, 0) as area_priority,
        a.timings as area_timings,
        COALESCE(
          (SELECT o.quantity
            FROM orders o
            WHERE o.customer_id = c.customer_id
            AND o.milk_type = 'cow'
            AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            ORDER BY o.order_date DESC
            LIMIT 1
          ), 0
        ) as last_cow_quantity,
        COALESCE(
          (SELECT o.price
            FROM orders o
            WHERE o.customer_id = c.customer_id
            AND o.milk_type = 'cow'
            AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            ORDER BY o.order_date DESC
            LIMIT 1
          ), 0
        ) as last_cow_price,
        COALESCE(
          (SELECT o.quantity
            FROM orders o
            WHERE o.customer_id = c.customer_id
            AND o.milk_type = 'buffalo'
            AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            ORDER BY o.order_date DESC
            LIMIT 1
          ), 0
        ) as last_buffalo_quantity,
        COALESCE(
          (SELECT o.price
            FROM orders o
            WHERE o.customer_id = c.customer_id
            AND o.milk_type = 'buffalo'
            AND o.order_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
            ORDER BY o.order_date DESC
            LIMIT 1
          ), 0
        ) as last_buffalo_price,
        COALESCE(
          (SELECT o.order_date
            FROM orders o
            WHERE o.customer_id = c.customer_id
            ORDER BY o.order_date DESC
            LIMIT 1
          ), NULL
        ) as last_order_date
      FROM customers c
      LEFT JOIN areas a ON c.area_id = a.area_id
      WHERE c.admin_id = ?
      AND (c.delivery_timing = ? OR c.delivery_timing = 3)  -- Include both the specific timing and "both" timing (3)
      AND (a.timings IS NULL OR a.timings = ? OR a.timings = 0 OR a.timings = 3)
      ORDER BY 
        CASE 
          WHEN a.timings = ? THEN 0  -- Areas explicitly matching requested timing come first
          WHEN a.timings = 3 THEN 1  -- Areas with "both" timing come second
          WHEN a.timings IS NULL THEN 2  -- Areas with no timing specified come next
          ELSE 3  -- Other areas come last
        END,
        COALESCE(a.priority, 999) ASC,  -- Then order by priority
        c.name ASC  -- Then by customer name
    `;
    
    const [customers] = await pool.query(query, [adminId, timing, timing, timing]);
    
    // Process the results - Include original delivery_timing in response
    const processedCustomers = customers.map(customer => ({
      customer_id: customer.customer_id,
      name: customer.name,
      address: customer.address,
      phone: customer.phone,
      delivery_timing: Number(customer.delivery_timing), // Keep original delivery timing (1, 2, or 3)
      requested_timing: Number(timing), // Add the requested timing for reference
      area_id: customer.area_id,
      area_name: customer.area_name,
      area_priority: Number(customer.area_priority || 0),
      area_timings: customer.area_timings ? Number(customer.area_timings) : null,
      last_quantity: Math.max(Number(customer.last_cow_quantity || 0), Number(customer.last_buffalo_quantity || 0)), // Keep existing field for compatibility
      last_price: Math.max(Number(customer.last_cow_price || 0), Number(customer.last_buffalo_price || 0)), // Keep existing field for compatibility
      last_cow_quantity: Number(customer.last_cow_quantity || 0),
      last_cow_price: Number(customer.last_cow_price || 0),
      last_buffalo_quantity: Number(customer.last_buffalo_quantity || 0),
      last_buffalo_price: Number(customer.last_buffalo_price || 0),
      last_order_date: customer.last_order_date,
      hasRecentOrder: customer.last_order_date ? 
        (new Date(customer.last_order_date) >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) : 
        false
    }));
    
    res.json({
      success: true,
      timing: Number(timing),
      total_customers: processedCustomers.length,
      customers: processedCustomers
    });
    
  } catch (error) {
    console.error('Error fetching customers by timing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customers',
      error: error.message
    });
  }
});

// Test route to verify the API is accessible
app.get('/customers-by-timing-test', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'Customers by timing API is accessible',
    endpoints: {
      morning: '/customers-by-timing/1',
      night: '/customers-by-timing/2'
    }
  });
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

app.put('/admin/customer/:customerId', verifyToken, async (req, res) => {
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin privileges required.'
      });
    }
    
    const { customerId } = req.params;
    const { name, phone, address, password, area_id, delivery_timing } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required'
      });
    }
    
    // Check if customer exists
    const [currentCustomerResult] = await pool.query(
      'SELECT * FROM customers WHERE customer_id = ? AND admin_id = ?',
      [customerId, req.user.admin_id]
    );
    
    if (currentCustomerResult.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found or you do not have permission to modify this customer'
      });
    }
    
    // Build the update query with only the fields that need to be updated
    const updateFields = [];
    const queryParams = [];
    
    // Always update name
    updateFields.push('name = ?');
    queryParams.push(name);
    
    // Only include phone if provided
    if (phone !== undefined) {
      updateFields.push('phone = ?');
      queryParams.push(phone);
    }
    
    // Only include address if provided
    if (address !== undefined) {
      updateFields.push('address = ?');
      queryParams.push(address);
    }
    
    // Only update password if provided and not empty
    if (password && password.trim() !== '') {
      updateFields.push('password = ?');
      queryParams.push(password);
    }
    
    // Handle area_id (can be null to remove area association)
    if (area_id !== undefined) {
      updateFields.push('area_id = ?');
      queryParams.push(area_id === null ? null : area_id);
    }
    
    // Handle delivery_timing (1 = Morning, 2 = Evening, 3 = Both)
    if (delivery_timing !== undefined) {
      updateFields.push('delivery_timing = ?');
      queryParams.push(delivery_timing);
    }
    
    // Add WHERE clause parameters
    queryParams.push(customerId, req.user.admin_id);
    
    // Construct the final query
    const updateQuery = `UPDATE customers SET ${updateFields.join(', ')} WHERE customer_id = ? AND admin_id = ?`;
    
    // Execute the update
    const [result] = await pool.query(updateQuery, queryParams);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found or no changes were made'
      });
    }
    
    // Get updated customer details with area information
    const [updatedCustomer] = await pool.query(
      `SELECT c.customer_id, c.name, c.phone, c.address, c.delivery_timing, 
       c.area_id, a.area_name 
       FROM customers c
       LEFT JOIN areas a ON c.area_id = a.area_id
       WHERE c.customer_id = ?`,
      [customerId]
    );
    
    // Update cache if it exists and is properly initialized
    try {
      const cacheKey = `customer:${customerId}`;
      if (customerCache && customerCache.has && customerCache.has(cacheKey)) {
        const cachedCustomer = customerCache.get(cacheKey);
        const updatedCachedCustomer = { ...cachedCustomer, name };
        
        if (phone !== undefined) updatedCachedCustomer.phone = phone;
        if (address !== undefined) updatedCachedCustomer.address = address;
        if (password && password.trim() !== '') updatedCachedCustomer.password = password;
        if (area_id !== undefined) updatedCachedCustomer.area_id = area_id;
        if (delivery_timing !== undefined) updatedCachedCustomer.delivery_timing = delivery_timing;
        
        customerCache.set(cacheKey, updatedCachedCustomer);
      }
    } catch (cacheError) {
      console.warn('Cache update failed:', cacheError.message);
      // Continue execution even if cache update fails
    }
    
    return res.status(200).json({
      success: true,
      message: 'Customer updated successfully',
      customer: updatedCustomer[0]
    });
    
  } catch (err) {
    console.error('❌ Error updating customer:', err);
    return res.status(500).json({
      success: false,
      message: 'Database error: ' + (err.message || 'Unknown error'),
      error: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});


// Delete customer
app.delete('/admin/customer/:customerId', verifyToken, async (req, res) => {
  const connection = await pool.getConnection();
  
  try {
    // Ensure the user is authenticated as an admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }
    
    await connection.beginTransaction();
    
    const { customerId } = req.params;
    const { transferAdvance } = req.query;
    
    // Verify customer belongs to this admin
    const [customerCheck] = await connection.query(
      'SELECT customer_id, admin_id FROM customers WHERE customer_id = ?',
      [customerId]
    );
    
    if (customerCheck.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }
    
    if (customerCheck[0].admin_id !== req.user.admin_id) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this customer'
      });
    }
    
    // Check if customer has pending orders
    const [pendingOrders] = await connection.query(
      "SELECT COUNT(*) as count FROM orders WHERE customer_id = ? AND payment_status IN ('Pending', 'Partially Paid')",
      [customerId]
    );
    
    if (pendingOrders[0].count > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete customer with pending orders. Please settle all orders first.'
      });
    }
    
    // Check if customer has advance balance
    const [advanceCheck] = await connection.query(
      'SELECT advance_amount FROM customer_advances WHERE customer_id = ? AND advance_amount > 0',
      [customerId]
    );
    
    if (advanceCheck.length > 0 && !transferAdvance) {
      return res.status(400).json({
        success: false,
        message: `Customer has an advance balance of ${advanceCheck[0].advance_amount}. Use transferAdvance=true parameter to handle this balance.`
      });
    }
    
    // Delete related records in proper order to maintain referential integrity
    // 1. Delete any payment records
    await connection.query('DELETE FROM payments WHERE customer_id = ?', 0[customerId]);
    
    // 2. Delete any advances
    await connection.query('DELETE FROM customer_advances WHERE customer_id = ?', [customerId]);
    
    // 3. Delete any orders
    await connection.query('DELETE FROM orders WHERE customer_id = ?', [customerId]);
    
    // 4. Finally delete the customer
    await connection.query('DELETE FROM customers WHERE customer_id = ?', [customerId]);
    
    // Remove from cache if exists
    const cacheKey = `customer:${customerId}`;
    if (customerCache.has(cacheKey)) {
      customerCache.delete(cacheKey);
    }
    
    await connection.commit();
    
    return res.status(200).json({
      success: true,
      message: 'Customer deleted successfully'
    });
    
  } catch (err) {
    await connection.rollback();
    console.error('❌ Error deleting customer:', err.message);
    return res.status(500).json({ 
      success: false, 
      message: 'Database error',
      error: err.message 
    });
  } finally {
    connection.release();
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

app.listen(8080, () => {
  console.log(`🚀 Server running on http://localhost:13000`);
});

