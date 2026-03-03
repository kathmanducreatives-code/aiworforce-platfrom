-- Allow anonymous uploads to screening-resumes bucket
CREATE POLICY "Allow anonymous uploads to screening-resumes"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'screening-resumes');

-- Allow authenticated users to read screening resumes
CREATE POLICY "Allow authenticated read on screening-resumes"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'screening-resumes');

-- Allow anonymous users to also read (for parse-resume to work via client)
CREATE POLICY "Allow anon read on screening-resumes"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'screening-resumes');

-- Also ensure screening_applications allows anonymous inserts (for public candidate flow)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous insert for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous insert for candidates" ON public.screening_applications FOR INSERT TO anon WITH CHECK (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous update for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous update for candidates" ON public.screening_applications FOR UPDATE TO anon USING (true)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'screening_applications' AND policyname = 'Allow anonymous select for candidates'
  ) THEN
    EXECUTE 'CREATE POLICY "Allow anonymous select for candidates" ON public.screening_applications FOR SELECT TO anon USING (true)';
  END IF;
END $$;