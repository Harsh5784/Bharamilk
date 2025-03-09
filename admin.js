const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5001; // Changed port to 5001

// Middleware
app.use(cors());
app.use(bodyParser.json());

// MySQL Connection
const db = mysql.createConnection({
  host: 'sql12.freesqldatabase.com',  // Remote database host
  user: 'sql12756236',                // Your database username
  password: '3x2ctS2Tlk',             // Your database password
  database: 'sql12756236',            // Your database name
  port: 3306                          // Default MySQL port
});

// Connect to MySQL
db.connect((err) => {
  if (err) {
    console.error('❌ Error connecting to the database:', err.message);
    process.exit(1); // Stop the server if database connection fails
  } else {
    console.log('✅ Connected to the remote MySQL database');
  }
});

// Login API
app.post('/login', (req, res) => {
  const { customerId, password } = req.body;

  if (!customerId || !password) {
    return res.status(400).json({ message: 'Customer ID and password are required' });
  }

  const query = 'SELECT * FROM customers WHERE customer_id = ?';
  db.query(query, [customerId], (err, results) => {
    if (err) {
      console.error('❌ Error during database query:', err.message);
      return res.status(500).json({ message: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ message: 'Customer ID not found' });
    }

    const user = results[0];
    if (password.trim() !== user.password.trim()) {
      return res.status(401).json({ message: 'Incorrect password' });
    }

    const token = jwt.sign(
      { customerId: user.customer_id, name: user.name },
      process.env.JWT_SECRET || 'defaultsecret',
      { expiresIn: '1h' }
    );

    return res.status(200).json({ message: 'Login successful', token });
  });
});

// Orders API
app.get('/orders', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(403).json({ message: 'Authorization required' });

  jwt.verify(token, process.env.JWT_SECRET || 'defaultsecret', (err, decoded) => {
    if (err) return res.status(403).json({ message: 'Invalid token' });

    const customerId = decoded.customerId;

    const query = 'SELECT * FROM orders WHERE customer_id = ?';
    db.query(query, [customerId], (err, results) => {
      if (err) {
        console.error('❌ Error fetching orders:', err.message);
        return res.status(500).json({ message: 'Error fetching orders' });
      }

      res.json({ orders: results });
    });
  });
});

// Test endpoint to ensure server is running
app.get('/', (req, res) => {
  res.send('✅ Server is running');
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running on http://localhost:${port}`);
});
