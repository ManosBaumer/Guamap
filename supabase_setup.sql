-- Run this in your Supabase SQL Editor

CREATE TABLE public.saved_listings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) NOT NULL,
    listing_id bigint NOT NULL,
    community_id text NOT NULL,
    community_name text NOT NULL,
    listing jsonb NOT NULL,
    saved_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE(user_id, listing_id)
);

-- Set up Row Level Security (RLS)
ALTER TABLE public.saved_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own saved listings."
    ON public.saved_listings FOR INSERT
    WITH CHECK ( auth.uid() = user_id );

CREATE POLICY "Users can view their own saved listings."
    ON public.saved_listings FOR SELECT
    USING ( auth.uid() = user_id );

CREATE POLICY "Users can update their own saved listings."
    ON public.saved_listings FOR UPDATE
    USING ( auth.uid() = user_id );

CREATE POLICY "Users can delete their own saved listings."
    ON public.saved_listings FOR DELETE
    USING ( auth.uid() = user_id );
