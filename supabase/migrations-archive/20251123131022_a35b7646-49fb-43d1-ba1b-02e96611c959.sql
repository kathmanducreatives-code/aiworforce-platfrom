-- Fix infinite recursion in collaboration RLS policies

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view room members" ON collaboration_room_members;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;
DROP POLICY IF EXISTS "Room members can view messages" ON collaboration_messages;
DROP POLICY IF EXISTS "Room members can view attachments" ON collaboration_candidate_attachments;
DROP POLICY IF EXISTS "Room members can view comments" ON collaboration_candidate_comments;
DROP POLICY IF EXISTS "Room members can view tags" ON collaboration_candidate_tags;

-- Create security definer function to check room membership without recursion
CREATE OR REPLACE FUNCTION public.is_room_member(_user_id uuid, _room_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM collaboration_room_members
    WHERE user_id = _user_id
      AND room_id = _room_id
  )
$$;

-- Recreate policies using the security definer function

-- collaboration_room_members policies
CREATE POLICY "Users can view room members"
ON collaboration_room_members
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_rooms policies
CREATE POLICY "Users can view rooms they are members of"
ON collaboration_rooms
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), id));

-- collaboration_messages policies
CREATE POLICY "Room members can view messages"
ON collaboration_messages
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_candidate_attachments policies
CREATE POLICY "Room members can view attachments"
ON collaboration_candidate_attachments
FOR SELECT
TO authenticated
USING (public.is_room_member(auth.uid(), room_id));

-- collaboration_candidate_comments policies
CREATE POLICY "Room members can view comments"
ON collaboration_candidate_comments
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM collaboration_candidate_attachments a
    WHERE a.id = collaboration_candidate_comments.attachment_id
      AND public.is_room_member(auth.uid(), a.room_id)
  )
);

-- collaboration_candidate_tags policies
CREATE POLICY "Room members can view tags"
ON collaboration_candidate_tags
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM collaboration_candidate_attachments a
    WHERE a.id = collaboration_candidate_tags.attachment_id
      AND public.is_room_member(auth.uid(), a.room_id)
  )
);