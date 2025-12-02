-- Enable realtime for collaboration tables
ALTER TABLE collaboration_rooms REPLICA IDENTITY FULL;
ALTER TABLE collaboration_messages REPLICA IDENTITY FULL;
ALTER TABLE collaboration_room_members REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_attachments REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_comments REPLICA IDENTITY FULL;
ALTER TABLE collaboration_candidate_tags REPLICA IDENTITY FULL;

-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_room_members;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_attachments;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE collaboration_candidate_tags;