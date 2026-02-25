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

    // Helper function to convert risk/reward factors to numbers
    const convertFactorToNumber = (factor: string): number => {
      if (!factor) return 0;
      const cleanFactor = factor.toLowerCase().trim();
      if (cleanFactor.includes('high')) return 8;
      if (cleanFactor.includes('medium')) return 5;
      if (cleanFactor.includes('low')) return 2;
      // Try to parse as number if it's already numeric
      const numericValue = parseFloat(factor);
      return isNaN(numericValue) ? 0 : numericValue;
    };

    const analysisData = dataRows.map((row: any[], index: number) => ({
      id: `analysis-${index}`,
      date: row[0] || '',
      resume: row[1] || '',
      firstName: row[2] || '',
      lastName: row[3] || '',
      email: row[4] || '',
      strengths: row[5] || '',
      weaknesses: row[6] || '',
      riskFactor: convertFactorToNumber(row[7]),
      rewardFactor: convertFactorToNumber(row[8]),
      overallFactor: convertFactorToNumber(row[9]),
      justification: row[10] || '',
      riskScore: row[7] || '',
      rewardScore: row[8] || '',
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
  } catch (error: unknown) {
    console.error('Error in get-resume-analysis function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: [],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});