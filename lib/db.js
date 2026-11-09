const { createClient } = require('@supabase/supabase-js');

// Supabase com service role key — nunca exposta ao browser
const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

module.exports = db;
