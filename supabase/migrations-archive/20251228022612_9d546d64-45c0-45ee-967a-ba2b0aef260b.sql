-- Create screening_templates table
CREATE TABLE public.screening_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  role_focus TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create screening_template_questions table
CREATE TABLE public.screening_template_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.screening_templates(id) ON DELETE CASCADE,
  scenario_id UUID REFERENCES public.screening_scenarios(id),
  category TEXT NOT NULL,
  question_text TEXT NOT NULL,
  follow_up_prompts JSONB DEFAULT '[]',
  difficulty_level INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add template_id to adaptive_screening_sessions
ALTER TABLE public.adaptive_screening_sessions
ADD COLUMN template_id UUID REFERENCES public.screening_templates(id);

-- Enable RLS on screening_templates
ALTER TABLE public.screening_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_templates
CREATE POLICY "Authenticated users can view templates"
ON public.screening_templates FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create templates"
ON public.screening_templates FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update templates"
ON public.screening_templates FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete templates"
ON public.screening_templates FOR DELETE
USING (true);

-- Enable RLS on screening_template_questions
ALTER TABLE public.screening_template_questions ENABLE ROW LEVEL SECURITY;

-- RLS policies for screening_template_questions
CREATE POLICY "Authenticated users can view template questions"
ON public.screening_template_questions FOR SELECT
USING (true);

CREATE POLICY "Authenticated users can create template questions"
ON public.screening_template_questions FOR INSERT
WITH CHECK (true);

CREATE POLICY "Authenticated users can update template questions"
ON public.screening_template_questions FOR UPDATE
USING (true);

CREATE POLICY "Authenticated users can delete template questions"
ON public.screening_template_questions FOR DELETE
USING (true);

-- Create trigger for updated_at on screening_templates
CREATE TRIGGER update_screening_templates_updated_at
BEFORE UPDATE ON public.screening_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert a default template with existing scenarios
INSERT INTO public.screening_templates (name, description, is_default)
VALUES ('Default Behavioral Screening', 'Standard behavioral assessment covering all scenario categories', true);

-- Copy existing scenarios to the default template
INSERT INTO public.screening_template_questions (template_id, scenario_id, category, question_text, follow_up_prompts, difficulty_level, sort_order, is_custom)
SELECT 
  (SELECT id FROM public.screening_templates WHERE is_default = true LIMIT 1),
  id,
  category::text,
  scenario_prompt,
  follow_up_prompts,
  difficulty_level,
  ROW_NUMBER() OVER (PARTITION BY category ORDER BY created_at),
  false
FROM public.screening_scenarios
WHERE is_active = true;