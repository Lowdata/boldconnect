// config/aiClient.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    throw new Error('GEMINI_API_KEY not found in environment variables');
}

const genAI = new GoogleGenerativeAI(apiKey);

// Choose a model (e.g., gemini-pro for text generation)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro-exp-03-25' });

async function callAI(prompt) {
    try {
        console.log("--- Calling AI ---");
        // console.log("Prompt:", prompt); // Uncomment for debugging
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        console.log("--- AI Response Received ---");
        // console.log("Response Text:", text); // Uncomment for debugging
        return text;
    } catch (error) {
        console.error('Error calling AI:', error);
        throw new Error('Failed to get response from AI');
    }
}

module.exports = { callAI };