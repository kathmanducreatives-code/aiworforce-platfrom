-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can create rooms" ON collaboration_rooms;
DROP POLICY IF EXISTS "Users can view rooms they are members of" ON collaboration_rooms;

-- Create PERMISSIVE INSERT policy for authenticated users
CREATE POLICY "Authenticated users can create rooms"
ON collaboration_rooms
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = created_by);

-- Create PERMISSIVE SELECT policy that allows members OR creators to view rooms
CREATE POLICY "Users can view rooms they are members of or created"
ON collaboration_rooms
FOR SELECT
TO authenticated
USING (is_room_member(auth.uid(), id) OR auth.uid() = created_by);