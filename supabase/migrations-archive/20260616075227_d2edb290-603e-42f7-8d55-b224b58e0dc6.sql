DROP POLICY IF EXISTS "Anyone can create applications" ON public.screening_applications;
CREATE POLICY "Anyone can create applications for active jobs"
ON public.screening_applications
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.screening_jobs j
    WHERE j.id = screening_applications.job_id AND j.status = 'active'
  )
);

DROP POLICY IF EXISTS "Public upload resumes scoped to job" ON storage.objects;
CREATE POLICY "Public upload resumes scoped to active job"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'screening-resumes'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.screening_jobs j
    WHERE j.id::text = (storage.foldername(objects.name))[1]
      AND j.status = 'active'
  )
);