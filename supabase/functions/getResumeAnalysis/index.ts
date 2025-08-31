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
    console.log('Get resume analysis function called');

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

    // Fetch data from Google Sheets
    const sheetsResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${credentials.spreadsheet_id}/values/Sheet1`,
      {
        headers: {
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!sheetsResponse.ok) {
      const error = await sheetsResponse.json();
      console.error('Google Sheets API error:', error);
      throw new Error(`Failed to fetch from Google Sheets: ${error.error?.message || 'Unknown error'}`);
    }

    const sheetsData = await sheetsResponse.json();
    console.log('Fetched data from Google Sheets:', sheetsData);

    // Parse the data (skip header row)
    const rows = sheetsData.values || [];
    const dataRows = rows.slice(1); // Skip header row

    const analysisData = dataRows.map((row: any[], index: number) => ({
      id: `analysis-${index}`,
      date: row[0] || '',
      resume: row[1] || '',
      firstName: row[2] || '',
      lastName: row[3] || '',
      email: row[4] || '',
      strengths: row[5] || '',
      weaknesses: row[6] || '',
      riskFactor: parseFloat(row[7]) || 0,
      rewardFactor: parseFloat(row[8]) || 0,
      overallFactor: parseFloat(row[9]) || 0,
      justification: row[10] || '',
    }));

    console.log(`Successfully fetched ${analysisData.length} analysis results`);

    return new Response(
      JSON.stringify({
        success: true,
        data: analysisData,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in get-resume-analysis function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        data: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});