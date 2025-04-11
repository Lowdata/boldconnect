// routes/queryRoutes.js
const express = require('express');
const { processUserQuery } = require('../services/queryService');
const router = express.Router();

router.post('/', async (req, res) => {
    const { prompt, userId } = req.body; // Assuming userId is passed in request body

    if (!prompt || !userId) {
        return res.status(400).json({ error: 'Missing "prompt" or "userId" in request body' });
    }

    try {
        const result = await processUserQuery(prompt, userId);
        res.json(result);
    } catch (error) {
        console.error("Query processing error:", error);
        // Send a more generic error to the client
        res.status(500).json({ error: error.message || 'An internal server error occurred' });
    }
});

module.exports = router;