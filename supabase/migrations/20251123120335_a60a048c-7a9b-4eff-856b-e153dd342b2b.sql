-- Create candidate source enum
CREATE TYPE candidate_source AS ENUM ('resume_screening', 'deep_search', 'linkedin_scraper');

-- Create collaboration rooms table
CREATE TABLE public.collaboration_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_archived BOOLEAN DEFAULT false
);

-- Create room members table
CREATE TABLE public.collaboration_room_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- Create messages table
CREATE TABLE public.collaboration_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  mentions UUID[] DEFAULT array[]::UUID[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  is_deleted BOOLEAN DEFAULT false
);

-- Create candidate attachments table
CREATE TABLE public.collaboration_candidate_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES public.collaboration_rooms(id) ON DELETE CASCADE NOT NULL,
  candidate_source candidate_source NOT NULL,
  candidate_id UUID NOT NULL,
  attached_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  attached_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  fit_score INTEGER,
  custom_notes TEXT,
  UNIQUE(room_id, candidate_source, candidate_id)
);

-- Create candidate comments table
CREATE TABLE public.collaboration_candidate_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  comment TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create candidate tags table
CREATE TABLE public.collaboration_candidate_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES public.collaboration_candidate_attachments(id) ON DELETE CASCADE NOT NULL,
  tag TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(attachment_id, tag)
);

-- Create contact history table
CREATE TABLE public.collaboration_contact_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_source candidate_source NOT NULL,
  candidate_id UUID NOT NULL,
  contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  contacted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  contact_method TEXT,
  notes TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.collaboration_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_candidate_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collaboration_contact_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies for collaboration_rooms
CREATE POLICY "Users can view rooms they are members of"
  ON public.collaboration_rooms FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_rooms.id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Authenticated users can create rooms"
  ON public.collaboration_rooms FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Room creators can update their rooms"
  ON public.collaboration_rooms FOR UPDATE
  USING (auth.uid() = created_by);

-- RLS Policies for collaboration_room_members
CREATE POLICY "Users can view room members"
  ON public.collaboration_room_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members m
      WHERE m.room_id = collaboration_room_members.room_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join rooms"
  ON public.collaboration_room_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their membership"
  ON public.collaboration_room_members FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_messages
CREATE POLICY "Room members can view messages"
  ON public.collaboration_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_messages.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can send messages"
  ON public.collaboration_messages FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_messages.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own messages"
  ON public.collaboration_messages FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_candidate_attachments
CREATE POLICY "Room members can view attachments"
  ON public.collaboration_candidate_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can attach candidates"
  ON public.collaboration_candidate_attachments FOR INSERT
  WITH CHECK (
    auth.uid() = attached_by AND
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can update attachments"
  ON public.collaboration_candidate_attachments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_room_members
      WHERE room_id = collaboration_candidate_attachments.room_id
      AND user_id = auth.uid()
    )
  );

-- RLS Policies for collaboration_candidate_comments
CREATE POLICY "Room members can view comments"
  ON public.collaboration_candidate_comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_comments.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can add comments"
  ON public.collaboration_candidate_comments FOR INSERT
  WITH CHECK (
    auth.uid() = user_id AND
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_comments.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their comments"
  ON public.collaboration_candidate_comments FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for collaboration_candidate_tags
CREATE POLICY "Room members can view tags"
  ON public.collaboration_candidate_tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_tags.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Room members can add tags"
  ON public.collaboration_candidate_tags FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    EXISTS (
      SELECT 1 FROM public.collaboration_candidate_attachments a
      JOIN public.collaboration_room_members m ON m.room_id = a.room_id
      WHERE a.id = collaboration_candidate_tags.attachment_id
      AND m.user_id = auth.uid()
    )
  );

CREATE POLICY "Tag creators can delete tags"
  ON public.collaboration_candidate_tags FOR DELETE
  USING (auth.uid() = created_by);

-- RLS Policies for collaboration_contact_history
CREATE POLICY "Anyone can view contact history"
  ON public.collaboration_contact_history FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can record contacts"
  ON public.collaboration_contact_history FOR INSERT
  WITH CHECK (auth.uid() = contacted_by);

-- Enable realtime for key tables
ALTER TABLE public.collaboration_messages REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_attachments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_candidate_comments REPLICA IDENTITY FULL;
ALTER TABLE public.collaboration_contact_history REPLICA IDENTITY FULL;

-- Create indexes for performance
CREATE INDEX idx_room_members_user ON public.collaboration_room_members(user_id);
CREATE INDEX idx_room_members_room ON public.collaboration_room_members(room_id);
CREATE INDEX idx_messages_room ON public.collaboration_messages(room_id);
CREATE INDEX idx_messages_created ON public.collaboration_messages(created_at DESC);
CREATE INDEX idx_attachments_room ON public.collaboration_candidate_attachments(room_id);
CREATE INDEX idx_attachments_candidate ON public.collaboration_candidate_attachments(candidate_source, candidate_id);
CREATE INDEX idx_contact_history_candidate ON public.collaboration_contact_history(candidate_source, candidate_id);
CREATE INDEX idx_comments_attachment ON public.collaboration_candidate_comments(attachment_id);
CREATE INDEX idx_tags_attachment ON public.collaboration_candidate_tags(attachment_id);

-- Create trigger for updated_at
CREATE TRIGGER update_collaboration_rooms_updated_at
  BEFORE UPDATE ON public.collaboration_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_collaboration_messages_updated_at
  BEFORE UPDATE ON public.collaboration_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();