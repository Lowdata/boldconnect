/* eslint-disable no-useless-escape */
// services/promptEngineer.js

// --- DETAILED SCHEMA CONTEXT ---
// Define SCHEMA_CONTEXT only once
const SCHEMA_CONTEXT = `
You have access to a MongoDB database with the following collections and schemas:

**Collection: users**
* Purpose: Stores user information, authentication, and integration settings.
* Schema: _id (ObjectId), name (String), email (String), password (String), lastSyncedOtherContact (Date/null), ..., integrations (Object), isVerified (Boolean), createdAt (Date), updatedAt (Date), __v (Number), resetPasswordExpiry (Date/null), resetPasswordToken (String/null)
* Relationships: Root collection. Referenced by almost all others via userId.

**Collection: userSettings**
* Purpose: Stores user-specific application preferences.
* Schema: _id (ObjectId), userId (ObjectId -> users), ..., language (String), notifications (Object), theme (String), createdAt (Date), updatedAt (Date)
* Relationships: One-to-One with users via userId.

**Collection: contacts**
* Purpose: Detailed contact information, often aggregated (e.g., from LinkedIn).
* Schema: _id (ObjectId), userId (ObjectId -> users), biographies (Array), createdAt (Date), emailAddresses (Array), linkedInCertifications (Array), linkedInCourses (Array), linkedInEducation (Array), linkedInHeadline (String), linkedInHonors (Array), linkedInIndustry (String), linkedInLocation (String), linkedInMetadata (Object), linkedInProfileConnectionDate (Date/null), linkedInProfileCurrentRole (String), linkedInProfileFirstName (String), linkedInProfileFullName (String), linkedInProfileLastName (String), linkedInProjects (Array), linkedInSkills (Array), linkedInUrl (String), linkedInVolunteer (Array), linkedInexperience (Array), linkedInlanguages (Array), linkedInpublications (Array), names (Array), organizations (Array), resourceName (String), socialProfiles (Array), source (String), updatedAt (Date), goalFrequency (String/null), goalSetDate (Date/null), __v (Number) // Expanded slightly for clarity
* Relationships: Many-to-One with users via userId. Referenced by activities, contactlabelrelations, contacttags, interactions, reminders via contactId.
* Notes: 'organizations.name' usually refers to *companies/work places*. 'linkedInEducation.school' refers to *educational institutions*. Use the correct field based on context (e.g., "worked at X" vs. "studied at Y" or "from Y University").
* **A text index exists on fields like 'biographies.value', 'linkedInHeadline', 'linkedInexperience.title', 'linkedInexperience.description', 'linkedInSkills.name' allowing efficient free-text search using the MongoDB '$text' operator.**

**Collection: contactcards**
* Purpose: User's own profile cards (e.g., Personal, Business).
* Schema: _id (ObjectId), userId (ObjectId -> users), name (String), cardName (String), email (String), phone (String), linkedinUrl (String), ..., bio (String), createdAt (Date), updatedAt (Date), __v (Number)
* Relationships: Many-to-One with users via userId.

**Collection: labels**
* Purpose: User-created categories for contacts.
* Schema: _id (ObjectId), userId (ObjectId -> users), labelName (String), description (String), createdAt (Date)
* Relationships: Many-to-One with users via userId. Referenced by contactlabelrelations via labelId.

**Collection: contactlabelrelations** (JOIN TABLE)
* Purpose: Links contacts to labels (Many-to-Many).
* Schema: _id (ObjectId), contactId (ObjectId -> contacts), labelId (ObjectId -> labels), userId (ObjectId -> users), createdAt (Date), __v (Number)
* Relationships: Implements Many-to-Many between contacts and labels.

**Collection: tags**
* Purpose: User-created keywords/tags for contacts.
* Schema: _id (ObjectId), userId (ObjectId -> users), name (String), description (String), createdAt (Date)
* Relationships: Many-to-One with users via userId. Referenced by contacttags via tagId.

**Collection: contacttags** (JOIN TABLE)
* Purpose: Links contacts to tags (Many-to-Many).
* Schema: _id (ObjectId), contactId (ObjectId -> contacts), tagId (ObjectId -> tags), userId (ObjectId -> users), createdAt (Date), updatedAt(Date), __v (Number)
* Relationships: Implements Many-to-Many between contacts and tags.

**Collection: activities**
* Purpose: Log of significant actions related to a contact.
* Schema: _id (ObjectId), userId (ObjectId -> users), contactId (ObjectId -> contacts), activityType (String), description (String), createdAt (Date), updatedAt (Date), __v (Number)
* Relationships: Many-to-One with users, Many-to-One with contacts.

**Collection: interactions**
* Purpose: Log of communications (calls, emails) with a contact.
* Schema: _id (ObjectId), userId (ObjectId -> users), contactId (ObjectId -> contacts), type (String), date (Date), notes (String), createdAt (Date), updatedAt (Date), __v (Number)
* Relationships: Many-to-One with users, Many-to-One with contacts.

**Collection: reminders**
* Purpose: Scheduled reminders, optionally linked to contacts.
* Schema: _id (ObjectId), userId (ObjectId -> users), contactId (ObjectId/null -> contacts), task (String), notes (String), remindAt (Date), isRecurring (Boolean), ..., isCompleted (Boolean), createdAt (Date), updatedAt (Date), __v (Number)
* Relationships: Many-to-One with users. Optionally Many-to-One with contacts.

**Collection: notes**
* Purpose: General user notes.
* Schema: _id (ObjectId), userId (ObjectId -> users), title (String), content (String), date (Date), reminder (ObjectId/null -> reminders), createdAt (Date), updatedAt (Date), __v (Number)
* Relationships: Many-to-One with users. Optionally linked to reminders.

**Collection: subscriptions**
* Purpose: Stores push notification subscription details.
* Schema: _id (ObjectId), userId (ObjectId -> users), subscription (Object), __v (Number)
* Relationships: Many-to-One with users.

**Important Considerations:**
* Joins require MongoDB Aggregation Pipeline's '$lookup' stage.
* Filtering often requires '$match'. For potentially ambiguous terms like industry or job titles, consider generating an array of possible values or using partial regex matching without anchors (^$).
* Shaping output requires '$project'.
* Date comparisons might involve '$gte', '$lte'.
* Text search uses the '$text' operator and its index.
* Assume queries are for a specific user context.
---
`; // End of SCHEMA_CONTEXT template literal

// --- PROMPT TEMPLATES ---

// Removed the duplicate SCHEMA_CONTEXT declaration that was here.

// Updated Prompt 1: Identify Keywords/Collections (Explicit Regex for Labels/Tags)
function getIdentifyKeywordsPrompt(userQuery) {
    // Use template literal for multi-line string
    return `${SCHEMA_CONTEXT}

**Task:**
Analyze the user query for key entities, concepts, constraints, and values. Differentiate between criteria that map to specific structured fields and criteria requiring broader text search. Determine the primary collection and any related collections.

**User Query:** "${userQuery}"

**Output Format:**
Respond ONLY with a JSON object containing:
- "primaryCollection": (String) e.g., "contacts".
- "relatedCollections": (Array of Strings) e.g., ["labels", "contactlabelrelations", "tags", "contacttags"].
- "structuredFilters": (Object) Key-value pairs for filtering.
    * **IMPORTANT: For fields like 'labels.labelName' and 'tags.name', ALWAYS generate a case-insensitive regex object for the value, even if the user query seems specific. This handles variations in casing and potentially minor variations like plurals.** Example: \`{ "labels.labelName": { "$regex": "Searched Term", "$options": "i" } }\`
    * For ambiguous fields like 'linkedInIndustry' or job titles, provide an ARRAY of likely specific string values found in the database. Example: \`{"linkedInIndustry": ["Computer Software", "Information Technology & Services", "Software Development"]}\`.
    * For unambiguous fields (like specific school names), use a single string value.
    * Leave empty if no structured filters apply.
- "textSearchKeywords": (String) Space-separated keywords for broad text search (roles, concepts, industries). Extract relevant terms, *especially if the user query has potential misspellings or uses ambiguous terms that might not map perfectly to structured fields*. Leave empty if only structured fields are targeted.
- "projection": (Array of Strings) Optional: Suggested output fields.

**Example Interpretations:**

Query: "Show me VCs who invested in SaaS startups"
Output: \\\`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": ["tags", "contacttags"],
  "structuredFilters": {
      "tags.name": { "$regex": "SaaS", "$options": "i" } // Use regex for tags
  },
  "textSearchKeywords": "VC venture capital investor invested startup", // Broader terms
  "projection": ["names", "linkedInHeadline"]
}
\\\`\`\`

Query: "people from Google"
Output: \\\`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": [],
  "structuredFilters": {
      "organizations.name": "Google" // Specific organization, string is okay
                                      // OR could use: { "$regex": "Google", "$options": "i" } for flexibility
  },
  "textSearchKeywords": "",
  "projection": ["names", "organizations"]
}
\\\`\`\`

Query: "people in the software industry"
Output: \\\`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": [],
  "structuredFilters": {
      "linkedInIndustry": ["Computer Software", "Information Technology & Services", "Software Development", "Information Technology and Services"] // Array for industry
  },
  "textSearchKeywords": "",
  "projection": ["names", "linkedInIndustry"]
}
\\\`\`\`

Query: "can u tell me any School Froiend of mine with linkedin certificates" // Note the typo "Froiend"
Output: \\\`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": ["labels", "contactlabelrelations", "tags", "contacttags"],
  "structuredFilters": {
    "$or": [
      { "labels.labelName": { "$regex": "School Friend", "$options": "i" } }, // Use regex for labelName
      { "tags.name": { "$regex": "School Friend", "$options": "i" } }      // Use regex for tagName
                                                                           // AI should ideally correct "Froiend" to "Friend"
    ],
    "linkedInCertifications": { "$exists": true, "$not": { "$size": 0 } } // Filter for non-empty array
  },
  "textSearchKeywords": "School Froiend Friend linkedin certificates", // Include original term and corrected version
  "projection": ["names", "linkedInCertifications", "linkedInHeadline", "labels.labelName", "tags.name"] // Maybe project label/tag name
}
\\\`\`\`

Provide ONLY the JSON object.`; // End of getIdentifyKeywordsPrompt template literal
}

// --- Keep getGenerateQueryPrompt as is, but ensure it handles regex objects ---

// The existing getGenerateQueryPrompt logic should work IF it correctly handles
// receiving a pre-formed regex object within structuredFilters.
// Let's double-check its instructions:

function getGenerateQueryPrompt(userQuery, analysis) {
    // analysis is the JSON object from the previous step
    return `${SCHEMA_CONTEXT}

**User Query:** "${userQuery}"

**Analysis from previous step:**
\\\`\`\`json
${JSON.stringify(analysis, null, 2)}
\\\`\`\`

**Task:**
Generate a MongoDB Aggregation Pipeline based on the analysis:
1.  Start from the 'primaryCollection'. Assume an initial \$match for 'userId' will be added later.
2.  If 'textSearchKeywords' is present and not empty, add an early \$match stage: \`{ $text: { $search: "keywords here" } }\`.
3.  If needed ('relatedCollections' is not empty), perform \$lookup stages.
4.  Add further \$match stages for 'structuredFilters'.
    * **If the value for a filter key is an ARRAY, use \$in (e.g., \`{ "field": { "$in": [...] } }\`).**
    * **If the value is a STRING, use case-insensitive regex WITHOUT start (^) / end ($) anchors unless exact match is implied (e.g., \`{ "field": { "$regex": "value", "$options": "i" } }\`).**
    * **If the value is ALREADY a regex object (like \`{ "$regex": "pattern", "$options": "i" }\`), use that object directly in the match.**
    * Handle date strings/objects using appropriate operators (\$gte, \$lte, etc.). Apply filters to the correct fields (primary collection or looked-up fields like 'joinedLabels.labelName'). Handle complex filters like \`$or\` or \`$and\` present in the analysis.
5.  Structure the pipeline logically: User Match -> Text Match -> Lookups -> Structured/Lookup Field Match.
6.  Use a final \$project stage based on 'projection' or general relevance. Include \`{ score: { $meta: "textScore" } }\` if using \$text. Exclude internal/sensitive fields.

**Output Format:**
Respond ONLY with the MongoDB aggregation pipeline as a JSON array of stage objects: \`[ { ... stage 1 ... }, { ... stage 2 ... } ]\`. Return \`[]\` if query cannot be formed.

**Example Filter Stage Handling:**

// Analysis: { "linkedInIndustry": ["Value1", "Value2"] } -> Stage:
{ "$match": { "linkedInIndustry": { "$in": ["Value1", "Value2"] } } }

// Analysis: { "linkedInHeadline": "Director" } -> Stage:
{ "$match": { "linkedInHeadline": { "$regex": "Director", "$options": "i" } } }

// Analysis: { "labels.labelName": { "$regex": "School Friend", "$options": "i" } } -> Stage (likely within a $lookup pipeline or later $match):
// The generator needs to place this correctly, e.g., in a $match *after* the relevant $lookup OR *inside* the $lookup's pipeline.
// Example *inside* $lookup:
{
  "\$lookup": {
    "from": "contactlabelrelations", /* ... */
    "pipeline": [
      { "\$lookup": { "from": "labels", /* ... */ "as": "labelDetails" } },
      { "\$unwind": "\$labelDetails" }, // Optional: unwind for easier matching
      { "\$match": { "labelDetails.labelName": { "\$regex": "School Friend", "\$options": "i" } } } // Match on looked-up field
    ],
    "as": "..."
  }
}
// OR Example *after* $lookup:
{ "\$match": { "joinedLabelRelations.labelDetails.labelName": { "\$regex": "School Friend", "\$options": "i" } } } // Requires correct 'as' and potentially $unwind before


Provide ONLY the JSON array for the pipeline.`; // End of getGenerateQueryPrompt template literal
}


module.exports = {
    SCHEMA_CONTEXT, // Export the single SCHEMA_CONTEXT constant
    getIdentifyKeywordsPrompt,
    getGenerateQueryPrompt,
};