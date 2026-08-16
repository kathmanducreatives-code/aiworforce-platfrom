
-- 1) screening_applications: replace permissive anon UPDATE with token-gated RPC
DROP POLICY IF EXISTS "Candidates update in-progress applications" ON public.screening_applications;

CREATE OR REPLACE FUNCTION public.update_screening_application_with_token(
  p_id uuid,
  p_access_token text,
  p_extracted_data jsonb DEFAULT NULL,
  p_candidate_edits jsonb DEFAULT NULL,
  p_screening_answers jsonb DEFAULT NULL,
  p_tab_switches integer DEFAULT NULL,
  p_total_time_seconds integer DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS public.screening_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app public.screening_applications;
BEGIN
  SELECT a.* INTO app
  FROM public.screening_applications a
  JOIN public.screening_jobs j ON j.id = a.job_id
  WHERE a.id = p_id
    AND a.access_token = p_access_token
    AND j.status = 'active'
    AND a.status IS DISTINCT FROM 'completed';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid token or application not editable';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('started','in_progress','completed') THEN
    RAISE EXCEPTION 'Invalid status value';
  END IF;

  UPDATE public.screening_applications
  SET
    extracted_data       = COALESCE(p_extracted_data, extracted_data),
    candidate_edits      = COALESCE(p_candidate_edits, candidate_edits),
    screening_answers    = COALESCE(p_screening_answers, screening_answers),
    tab_switches         = COALESCE(p_tab_switches, tab_switches),
    total_time_seconds   = COALESCE(p_total_time_seconds, total_time_seconds),
    status               = COALESCE(p_status, status),
    completed_at         = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END
  WHERE id = p_id
  RETURNING * INTO app;

  RETURN app;
END;
$$;

REVOKE ALL ON FUNCTION public.update_screening_application_with_token(uuid,text,jsonb,jsonb,jsonb,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_screening_application_with_token(uuid,text,jsonb,jsonb,jsonb,integer,integer,text) TO anon, authenticated;

-- 2) interview_slots: keep recruiter-only RLS; expose booking via SECURITY DEFINER RPCs
CREATE OR REPLACE FUNCTION public.get_interview_booking_context(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.interview_slots;
  v_type public.interview_types;
  v_avail jsonb;
BEGIN
  SELECT * INTO v_slot
  FROM public.interview_slots
  WHERE booking_token = p_token
    AND status = 'available'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_type FROM public.interview_types WHERE id = v_slot.interview_type_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(a.*)), '[]'::jsonb) INTO v_avail
  FROM public.interview_availability a
  WHERE a.user_id = v_slot.recruiter_id AND a.is_active = true;

  RETURN jsonb_build_object(
    'slot', jsonb_build_object(
      'id', v_slot.id,
      'recruiter_id', v_slot.recruiter_id,
      'interview_type_id', v_slot.interview_type_id,
      'start_time', v_slot.start_time,
      'end_time', v_slot.end_time,
      'status', v_slot.status
    ),
    'interview_type', to_jsonb(v_type),
    'availability', v_avail
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_interview_booking_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_interview_booking_context(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.book_interview_with_token(
  p_token text,
  p_candidate_name text,
  p_candidate_email text,
  p_scheduled_at timestamptz
)
RETURNS public.interviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot public.interview_slots;
  v_type public.interview_types;
  v_interview public.interviews;
BEGIN
  SELECT * INTO v_slot
  FROM public.interview_slots
  WHERE booking_token = p_token
    AND status = 'available'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or already-booked slot';
  END IF;

  SELECT * INTO v_type FROM public.interview_types WHERE id = v_slot.interview_type_id;

  INSERT INTO public.interviews (
    slot_id, candidate_name, candidate_email, interview_type_id,
    recruiter_id, scheduled_at, duration_minutes, meeting_link, status
  ) VALUES (
    v_slot.id, p_candidate_name, p_candidate_email, v_slot.interview_type_id,
    v_slot.recruiter_id, p_scheduled_at,
    COALESCE(v_type.duration_minutes, 30),
    v_type.meeting_link_template,
    'scheduled'
  )
  RETURNING * INTO v_interview;

  UPDATE public.interview_slots SET status = 'booked' WHERE id = v_slot.id;

  RETURN v_interview;
END;
$$;

REVOKE ALL ON FUNCTION public.book_interview_with_token(text,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.book_interview_with_token(text,text,text,timestamptz) TO anon, authenticated;
