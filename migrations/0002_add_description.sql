-- Add description column to studios. Optional free-text tagline /
-- short description shown on the public studio page and listings.
-- Studio creation form offers an AI-generated suggestion via app.ai.
ALTER TABLE studios ADD COLUMN description TEXT;
