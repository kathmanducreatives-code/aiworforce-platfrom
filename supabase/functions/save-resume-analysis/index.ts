import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Save resume analysis function called');
    
    const { analysisData } = await req.json();
    console.log('Analysis data received:', analysisData);

    if (!analysisData || !Array.isArray(analysisData)) {
      throw new Error('Invalid analysis data provided');
    }

    const credentials = JSON.parse(Deno.env.get('GOOGLE_SHEETS_CREDENTIALS') || '{}');
    console.log('Google Sheets credentials loaded');

    // Get access token for Google Sheets API
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        refresh_token: credentials.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    const tokenData = await tokenResponse.json();
    console.log('Access token obtained');

    // Prepare data for Google Sheets
    const values = analysisData.map(item => [
      item.date,
      item.resume,
      item.firstName,
      item.lastName,
      item.email,
      item.strengths,
      item.weaknesses,
      item.riskFactor,
      item.rewardFactor,
      item.overallFactor,
      item.justification
    ]);

    // Append data to Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${credentials.spreadsheet_id}/values/Sheet1:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: values,
        }),
      }
    );

    if (!sheetsResponse.ok) {
      const error = await sheetsResponse.json();
      console.error('Google Sheets API error:', error);
      throw new Error(`Failed to save to Google Sheets: ${error.error?.message || 'Unknown error'}`);
    }

    console.log('Successfully saved analysis data to Google Sheets');

    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully saved ${analysisData.length} analysis results to Google Sheets`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in save-resume-analysis function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});