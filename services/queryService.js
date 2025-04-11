// services/queryService.js
const { callAI } = require('../config/aiClient');
const { getDB } = require('../config/db');
const { getIdentifyKeywordsPrompt, getGenerateQueryPrompt } = require('./promptEngineer');
const { ObjectId } = require('mongodb'); // Import ObjectId

// Helper to safely parse JSON from AI response
function safeJsonParse(text) {
    if (!text) return null;
    try {
        const cleanedText = text.replace(/^```json\s*|```$/g, '').trim();
        return JSON.parse(cleanedText);
    } catch (e) {
        console.error("Failed to parse AI JSON response:", text, e);
        return null;
    }
}

// Helper to convert relative dates - VERY BASIC EXAMPLE
function parseRelativeDate(dateString) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(todayStart.getDate() + 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    if (typeof dateString !== 'string') {
        return dateString;
    }
    const lowerDateString = dateString.toLowerCase();

    if (lowerDateString === 'last month') return { $gte: lastMonthStart, $lt: thisMonthStart };
    if (lowerDateString === 'this month') return { $gte: thisMonthStart, $lt: nextMonthStart };
    if (lowerDateString === 'today') return { $gte: todayStart, $lt: tomorrowStart };
    // Add more cases...
    return dateString;
}

// Helper to process filters for dates and ObjectIds (recursive) - Refined
function processDateFilters(filters) {
    // Ensure we don't process non-objects or null values
    if (!filters || typeof filters !== 'object') return filters;

    // Handle arrays: recursively process each element
    if (Array.isArray(filters)) {
        return filters.map(item => processDateFilters(item));
    }

    // Don't modify ObjectId instances directly
    if (filters instanceof ObjectId) {
        return filters;
    }

    // Create a new object to avoid potential side effects if `filters` is used elsewhere
    const processed = {};

    for (const key in filters) {
        // Skip the $text operator explicitly
        if (key === '$text') {
            processed[key] = filters[key]; // Copy $text as is
            continue;
        }

        const value = filters[key];

        // 1. Try converting string dates
        if (typeof value === 'string' && (key.includes('date') || key.includes('Date') || key.includes('remindAt') || key.includes('createdAt'))) {
            const dateCondition = parseRelativeDate(value);
            if (typeof dateCondition === 'object' && dateCondition !== null && (dateCondition.$gte || dateCondition.$lte)) {
                processed[key] = dateCondition;
                continue; // Move to next key once processed
            }
            // If not parsed as relative date, fall through to check if it's an ObjectId string
        }

        // 2. Try converting valid ObjectId strings (ONLY if it's a string)
        if (typeof value === 'string' && (key.endsWith('Id') || key === '_id') && ObjectId.isValid(value)) {
            try {
                processed[key] = new ObjectId(value);
                continue; // Move to next key
            } catch (e) {
                console.warn(`Could not convert ${key} value to ObjectId: ${value}`);
                processed[key] = value; // Keep original value if conversion fails
            }
        }
        // 3. Recurse for nested objects (that are not null and not arrays)
        else if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof ObjectId)) {
             processed[key] = processDateFilters(value); // Recurse
        }
         // 4. Recurse for arrays
         else if (Array.isArray(value)) {
             processed[key] = processDateFilters(value); // Recurse using array handling
         }
        // 5. Otherwise, copy the value as is (primitive, null, already ObjectId)
        else {
            processed[key] = value;
        }
    }
    return processed;
}


// Helper to inject date/ObjectId logic into pipeline stages (recursive)
function injectDateLogicIntoPipeline(pipeline) {
    if (!pipeline || !Array.isArray(pipeline)) return pipeline;

    // Use map to create a new pipeline array, ensuring stages are processed copies
    return pipeline.map(stage => {
        const stageKey = Object.keys(stage)[0];
        const stageValue = stage[stageKey];

        // Create a new stage object to avoid mutating the original pipeline array elements directly
        const newStage = {};

        if (stageKey === '$match') {
            newStage[stageKey] = processDateFilters(stageValue); // Process the match content
        } else if (stageKey === '$lookup' && typeof stageValue === 'object' && stageValue !== null && stageValue.pipeline) {
            // Create a new lookup object and recursively process its pipeline
             newStage[stageKey] = {
                 ...stageValue, // Copy other lookup properties
                 pipeline: injectDateLogicIntoPipeline(stageValue.pipeline) // Process nested pipeline
             };
        }
        // Add handling for other stages like $set, $addFields if they might contain dates/ObjectIds
        // else if (stageKey === '$set') {
        //    newStage[stageKey] = processDateFilters(stageValue);
        // }
        else {
            // For other stages, or stages without nested pipelines to process, just copy them
            newStage[stageKey] = stageValue;
        }
        return newStage; // Return the potentially modified copy of the stage
    });
}


async function processUserQuery(userQuery, userId) {
    console.log(`Processing query for user ${userId}: "${userQuery}"`);

    // --- Iteration 1: Identify Keywords & Collections ---
    const identifyPrompt = getIdentifyKeywordsPrompt(userQuery);
    const analysisResponse = await callAI(identifyPrompt);
    const analysis = safeJsonParse(analysisResponse);

    if (!analysis || !analysis.primaryCollection) {
        console.error("Failed to get valid analysis from AI.", analysisResponse);
        throw new Error("AI analysis failed.");
    }
    console.log("AI Analysis:", JSON.stringify(analysis, null, 2));

    // --- Iteration 2: Generate MongoDB Query ---
    const generatePrompt = getGenerateQueryPrompt(userQuery, analysis);
    const pipelineResponse = await callAI(generatePrompt);
    let pipeline = safeJsonParse(pipelineResponse);

    if (!pipeline || !Array.isArray(pipeline)) {
         console.error("Failed to get valid pipeline array from AI.", pipelineResponse);
        throw new Error("AI query generation failed.");
    }
    if (pipeline.length === 0 && !analysis.textSearchKeywords) {
         console.log("AI returned empty pipeline, and no text search specified.");
    }
    console.log("AI Generated Pipeline (Raw):", JSON.stringify(pipeline, null, 2));

    // --- Inject User Context ---
    let userObjectId;
    // Ensure userId is valid before creating ObjectId
    if (typeof userId === 'string' && ObjectId.isValid(userId)) {
        try { userObjectId = new ObjectId(userId); } catch (e) { throw new Error(`Invalid user ID format.`); }
    } else if (userId instanceof ObjectId) {
        userObjectId = userId;
    } else { throw new Error(`Invalid user ID provided: ${userId}`); }

    const primaryCollectionHasUserId = ['contacts', 'labels', 'tags', 'activities', 'interactions', 'reminders', 'notes', 'contactcards', 'userSettings'].includes(analysis.primaryCollection);

    if (primaryCollectionHasUserId) {
        if (pipeline.length > 0 && pipeline[0].$match && pipeline[0].$match.$text) {
            console.log("Injecting userId into the first ($text) match stage.");
            // Modify the first stage to include userId
             pipeline[0].$match = {
                 userId: userObjectId,
                 ...pipeline[0].$match // Ensure $text part is preserved
             };
        } else {
            // Prepend userId match if not already present implicitly or explicitly
            console.log("Prepending userId match stage.");
            const hasUserIdMatch = pipeline.some(stage => stage.$match && stage.$match.userId);
            if (!hasUserIdMatch) {
                 pipeline.unshift({ $match: { userId: userObjectId } });
            } else {
                 console.log("Skipping userId prepend, already handled.");
                 // Verify the existing userId match uses a proper ObjectId
                 pipeline = pipeline.map(stage => {
                     if (stage.$match && stage.$match.userId && !(stage.$match.userId instanceof ObjectId)) {
                         console.warn("Correcting non-ObjectId userId in existing match.");
                         stage.$match.userId = userObjectId;
                     }
                     return stage;
                 });
            }
        }
    } else {
         console.log(`Primary collection ${analysis.primaryCollection} does not require user filtering.`);
    }

     // --- Refine Pipeline (Dates/ObjectIds) ---
     // Apply AFTER userId injection using the refined functions
     pipeline = injectDateLogicIntoPipeline(pipeline);

    console.log("Final Pipeline (Processed):", JSON.stringify(pipeline, null, 2));

    // --- Execute Query ---
    const db = getDB();
    if (!analysis.primaryCollection || typeof analysis.primaryCollection !== 'string') {
        throw new Error('Invalid primary collection identified by AI.');
    }
    const collection = db.collection(analysis.primaryCollection);

    if (!Array.isArray(pipeline)) {
        throw new Error('Generated pipeline is not an array.');
    }

    let results = [];
    if (pipeline.length > 0) {
        try {
            // *** ADDED DEBUGGING LOGS ***
            const firstMatchStage = pipeline.find(stage => stage.$match);
            if (firstMatchStage && firstMatchStage.$match.userId) {
                 console.log("DEBUG: Type of userId before execution:", typeof firstMatchStage.$match.userId, "- Is ObjectId instance?", firstMatchStage.$match.userId instanceof ObjectId);
                 console.log("DEBUG: Value of userId before execution:", firstMatchStage.$match.userId);
                 // Attempt to log string representation if it's an ObjectId
                 if (firstMatchStage.$match.userId instanceof ObjectId) {
                      console.log("DEBUG: userId.toString():", firstMatchStage.$match.userId.toString());
                 }
            } else {
                 console.log("DEBUG: No userId found in first match stage before execution.");
            }
            console.log("DEBUG: Executing Pipeline Object:", JSON.stringify(pipeline)); // Stringify for cleaner full log

            results = await collection.aggregate(pipeline).toArray();
            console.log(`Query executed successfully, found ${results.length} results.`);
        } catch (error) {
            console.error("Error executing MongoDB aggregation pipeline:", error);
            console.error("Pipeline that failed during execution:", JSON.stringify(pipeline, null, 2));
            throw new Error("Database query execution failed.");
        }
    } else {
         console.log("Pipeline is empty, skipping database execution.");
    }

    return {
        message: `Found ${results.length} results.`,
        queryAnalysis: analysis,
        executedPipeline: pipeline,
        results: results
    };
}

module.exports = { processUserQuery };