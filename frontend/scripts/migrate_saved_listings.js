import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

// IMPORTANT: FILL THESE IN BEFORE RUNNING
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL'
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'

// The email of the account you created to migrate these listings to
const EMAIL = 'manossos06@gmail.com'
const PASSWORD = 'GuamapPassword2026!'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

async function migrate() {
  console.log('Logging in...')
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })

  if (authError) {
    console.error('Login failed:', authError.message)
    console.log('Make sure you have created the account manossos06@gmail.com with the password GuamapPassword2026! in your frontend first.')
    return
  }

  const userId = authData.user.id
  console.log(`Logged in as ${EMAIL} (${userId})`)

  const listingsPath = path.resolve(process.cwd(), '../data/saved_listings.json')
  if (!fs.existsSync(listingsPath)) {
    console.error('Could not find data/saved_listings.json at', listingsPath)
    return
  }

  const raw = fs.readFileSync(listingsPath, 'utf-8')
  const savedListings = JSON.parse(raw)

  console.log(`Found ${savedListings.length} saved listings. Migrating...`)

  for (const item of savedListings) {
    const { listing, communityId, communityName, savedAt } = item
    
    const { error } = await supabase.from('saved_listings').upsert({
      user_id: userId,
      listing_id: listing.id,
      community_id: communityId,
      community_name: communityName,
      listing: listing,
      saved_at: savedAt || new Date().toISOString()
    }, { onConflict: 'user_id, listing_id' })

    if (error) {
      console.error(`Failed to migrate listing ${listing.id}:`, error.message)
    } else {
      console.log(`Successfully migrated listing ${listing.id}`)
    }
  }

  console.log('Migration complete!')
}

migrate()
