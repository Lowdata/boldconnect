// services/promptEngineer.js

// --- DETAILED SCHEMA CONTEXT ---
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
* Notes: \`organizations.name\` usually refers to *companies/work places*. \`linkedInEducation.school\` refers to *educational institutions*. Use the correct field based on context (e.g., "worked at X" vs. "studied at Y" or "from Y University").
* **A text index exists on fields like \`biographies.value\`, \`linkedInHeadline\`, \`linkedInexperience.title\`, \`linkedInexperience.description\`, \`linkedInSkills.name\` allowing efficient free-text search using the MongoDB \`$text\` operator.**

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
* Joins require MongoDB Aggregation Pipeline's \`$lookup\` stage.
* Filtering often requires \`$match\`. For potentially ambiguous terms like industry or job titles, consider generating an array of possible values or using partial regex matching without anchors (^$).
* Shaping output requires \`$project\`.
* Date comparisons might involve \`$gte\`, \`$lte\`.
* Text search uses the \`$text\` operator and its index.
* Assume queries are for a specific user context.
---
`;

// --- PROMPT TEMPLATES ---

// Updated Prompt 1: Identify Keywords/Collections (Emphasizing array output with examples)
function getIdentifyKeywordsPrompt(userQuery) {
    return `
${SCHEMA_CONTEXT}

**Task:**
Analyze the user query for key entities, concepts, constraints, and values. Differentiate between criteria that map to specific structured fields (like labels, tags, organizations, education, industry) and criteria requiring a broader semantic text search. Determine the primary MongoDB collection and any related collections for joins.

**User Query:** "${userQuery}"

**Output Format:**
Respond ONLY with a JSON object containing:
- "primaryCollection": (String) e.g., "contacts".
- "relatedCollections": (Array of Strings) e.g., ["labels", "contactlabelrelations"].
- "structuredFilters": (Object) Key-value pairs for filtering on specific fields. **IMPORTANT: For ambiguous fields like 'linkedInIndustry' or job titles (e.g., 'software engineer'), you MUST provide an ARRAY of likely specific string values found in the database.** Example: If the user asks for "software industry", the value for "linkedInIndustry" MUST be an array like ["Computer Software", "Information Technology & Services", "Software Development"]. If the user asks for "software engineer", the value for a title field might be ["Software Engineer", "Senior Software Engineer", "Software Development Engineer"]. For unambiguous fields (like specific school names or labels), use a single string value. Leave empty if no structured filters apply.
- "textSearchKeywords": (String) A space-separated string of keywords relevant for a broad text search across indexed text fields (e.g., "investor funding startup venture capital"). Extract terms related to roles, concepts, industries mentioned semantically. Leave empty if the query targets only specific structured fields.
- "projection": (Array of Strings) Optional: Suggested output fields (e.g., ["names", "linkedInHeadline"]).

**Example Interpretations:**

Query: "Show me VCs who invested in SaaS startups"
Output: \`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": ["tags", "contacttags"],
  "structuredFilters": {"tags.name": "SaaS"},
  "textSearchKeywords": "VC venture capital investor invested",
  "projection": ["names", "linkedInHeadline"]
}
\`\`\`

Query: "people from Google"
Output: \`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": [],
  "structuredFilters": {"organizations.name": "Google"},
  "textSearchKeywords": "",
  "projection": ["names", "organizations"]
}
\`\`\`

Query: "people in the software industry"
Output: \`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": [],
  "structuredFilters": {"linkedInIndustry": ["Computer Software", "Information Technology & Services", "Software Development", "Information Technology and Services"]},
  "textSearchKeywords": "",
  "projection": ["names", "linkedInIndustry"]
}
\`\`\`

Query: "contacts who can help with funding"
Output: \`\`\`json
{
  "primaryCollection": "contacts",
  "relatedCollections": [],
  "structuredFilters": {},
  "textSearchKeywords": "funding fundraise investor angel venture capital seed investment finance",
  "projection": ["names", "linkedInHeadline"]
}
\`\`\`

Provide ONLY the JSON object.
`;
}


// Updated Prompt 2: Generate Query (handling $in for arrays, flexible regex for strings)
// This prompt remains the same as the previous version, as its logic was correct given the expected input format.
function getGenerateQueryPrompt(userQuery, analysis) {
    // analysis is the JSON object from the previous step
    return `
${SCHEMA_CONTEXT}

**User Query:** "${userQuery}"

**Analysis from previous step:**
\`\`\`json
${JSON.stringify(analysis, null, 2)}
\`\`\`

**Task:**
Generate a MongoDB Aggregation Pipeline based on the analysis:
1.  Start from the \`primaryCollection\`. Assume an initial \`$match\` for the specific user's \`userId\` will be added later.
2.  If \`textSearchKeywords\` is present in the analysis and not empty, add an early \`$match\` stage using the \`$text\` operator: \`{ $text: { $search: "keywords here" } }\`.
3.  If needed (\`relatedCollections\` is not empty), perform \`$lookup\` stages for \`relatedCollections\` to fetch data.
4.  Add further \`$match\` stages to apply the \`structuredFilters\`.
    * **If the value for a filter key in \`structuredFilters\` is an ARRAY, use the \`$in\` operator for the match (e.g., \`{ "linkedInIndustry": { "$in": ["Value1", "Value2"] } }\`).**
    * **If the value is a STRING, use case-insensitive regex BUT AVOID using start (^) and end ($) anchors unless an exact match is clearly implied by the user query. Use a simple substring match regex (e.g., \`{ "field": { "$regex": "value", "$options": "i" } }\`).**
    * Handle date strings by converting them to appropriate query operators ($gte, $lte) based on the current date: ${new Date().toISOString()}. Apply filters to the correct fields (primary collection or looked-up fields like \`joinedLabels.labelName\`).
5.  **Structure the pipeline logically:** User Match -> Text Match (if applicable) -> Lookups (if applicable) -> Match on Structured/Looked-up Fields (if applicable). Assume AND logic (sequential matches) unless OR is specified.
6.  Use a final \`$project\` stage based on the \`projection\` analysis or general relevance. Include \`{ score: { $meta: "textScore" } }\` if using \`$text\`. Exclude internal/sensitive fields.

**Output Format:**
Respond ONLY with the MongoDB aggregation pipeline as a JSON array of stage objects: \`[ { ... stage 1 ... }, { ... stage 2 ... } ]\`. Return \`[]\` if query cannot be formed.

**Example Structured Filter Stages:**
\`\`\`json
// If analysis was structuredFilters: {"linkedInIndustry": ["Computer Software", "IT&S"]}
{ "$match": { "linkedInIndustry": { "$in": ["Computer Software", "IT&S"] } } }

// If analysis was structuredFilters: {"linkedInHeadline": "Director"}
{ "$match": { "linkedInHeadline": { "$regex": "Director", "$options": "i" } } } // Partial match, case-insensitive
\`\`\`

Provide ONLY the JSON array for the pipeline.
`;
}


module.exports = {
    SCHEMA_CONTEXT,
    getIdentifyKeywordsPrompt,
    getGenerateQueryPrompt,
};