// config/db.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
if (!uri) {
    throw new Error('MONGODB_URI not found in environment variables');
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
    if (db) return db; // Return existing connection if available
    try {
        await client.connect();
        console.log('MongoDB Connected...');
        // Use the specific database name from your URI or define it here
        const dbName = uri.split('/').pop().split('?')[0]; // Basic parsing, adjust if needed
        db = client.db(dbName);
        return db;
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        // Exit process with failure
        process.exit(1);
    }
}

function getDB() {
    if (!db) {
        throw new Error('Database not initialized. Call connectDB first.');
    }
    return db;
}

// Close connection when the app shuts down
process.on('SIGINT', async () => {
    await client.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
});

module.exports = { connectDB, getDB };