// server.js
const express = require('express');
const dotenv = require('dotenv');
const { connectDB } = require('./config/db');
const queryRoutes = require('./routes/queryRoutes');

dotenv.config();

const app = express();

// Connect to Database
connectDB();

// Middleware
app.use(express.json()); // Parses incoming JSON requests

// Define Routes
app.get('/', (req, res) => {
    res.send('AI MongoDB Query API Running...');
});

app.use('/api/query', queryRoutes); // Mount the query routes

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server started on port ${PORT}`));