-- Phase 1: Extend resume_analyses table for enhanced tracking
ALTER TABLE resume_analyses 
ADD COLUMN IF NOT EXISTS screening_type TEXT DEFAULT 'auto',
ADD COLUMN IF NOT EXISTS processing_time_minutes INTEGER DEFAULT 2,
ADD COLUMN IF NOT EXISTS email_opened BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_clicked BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS nurturing_stage TEXT CHECK (nurturing_stage IN ('initial', 'engaged', 'follow_up', 'closed')),
ADD COLUMN IF NOT EXISTS current_stage TEXT DEFAULT 'initial_screening' CHECK (current_stage IN ('initial_screening', 'under_review', 'interview_ready', 'top_candidate', 'placed', 'rejected'));

-- Phase 2: Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name TEXT NOT NULL UNIQUE,
  contact_email TEXT,
  contact_name TEXT,
  industry TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

-- Create policies for clients table
CREATE POLICY "Public users can view clients" 
ON clients FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert clients" 
ON clients FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update clients" 
ON clients FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete clients" 
ON clients FOR DELETE 
USING (true);

-- Phase 3: Create client_placements table
CREATE TABLE IF NOT EXISTS client_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES resume_analyses(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  placement_date DATE NOT NULL,
  time_to_fill_days INTEGER,
  cost_per_hire DECIMAL(10, 2),
  position_opened_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on client_placements
ALTER TABLE client_placements ENABLE ROW LEVEL SECURITY;

-- Create policies for client_placements table
CREATE POLICY "Public users can view placements" 
ON client_placements FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert placements" 
ON client_placements FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update placements" 
ON client_placements FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete placements" 
ON client_placements FOR DELETE 
USING (true);

-- Phase 4: Create client_active_positions table
CREATE TABLE IF NOT EXISTS client_active_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  position_title TEXT NOT NULL,
  position_level TEXT CHECK (position_level IN ('entry', 'mid', 'senior', 'executive')),
  posted_date DATE NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'on_hold', 'filled', 'cancelled')),
  required_skills TEXT[],
  budget_range TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on client_active_positions
ALTER TABLE client_active_positions ENABLE ROW LEVEL SECURITY;

-- Create policies for client_active_positions table
CREATE POLICY "Public users can view active positions" 
ON client_active_positions FOR SELECT 
USING (true);

CREATE POLICY "Public users can insert active positions" 
ON client_active_positions FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Public users can update active positions" 
ON client_active_positions FOR UPDATE 
USING (true);

CREATE POLICY "Public users can delete active positions" 
ON client_active_positions FOR DELETE 
USING (true);

-- Create updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for clients table
DROP TRIGGER IF EXISTS update_clients_updated_at ON clients;
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();