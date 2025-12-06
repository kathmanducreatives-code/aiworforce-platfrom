import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 1x1 transparent GIF
const TRACKING_PIXEL = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b
]);

serve(async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const emailId = url.searchParams.get("id");
  const redirectUrl = url.searchParams.get("url");

  console.log(`Tracking event: type=${type}, id=${emailId}, url=${redirectUrl}`);

  if (!emailId) {
    console.error("Missing email ID");
    return new Response("Missing email ID", { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get user agent and IP for analytics
  const userAgent = req.headers.get("user-agent") || "";
  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                    req.headers.get("cf-connecting-ip") || 
                    "unknown";

  try {
    if (type === "open") {
      // Record open event
      console.log(`Recording open event for email ${emailId}`);
      
      const { error } = await supabase
        .from("email_tracking")
        .insert({
          scheduled_email_id: emailId,
          event_type: "open",
          user_agent: userAgent,
          ip_address: ipAddress,
        });

      if (error) {
        console.error("Error recording open event:", error);
      } else {
        console.log("Open event recorded successfully");
      }

      // Return tracking pixel
      return new Response(TRACKING_PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });

    } else if (type === "click") {
      if (!redirectUrl) {
        console.error("Missing redirect URL for click event");
        return new Response("Missing redirect URL", { status: 400 });
      }

      // Record click event
      console.log(`Recording click event for email ${emailId}, URL: ${redirectUrl}`);
      
      const { error } = await supabase
        .from("email_tracking")
        .insert({
          scheduled_email_id: emailId,
          event_type: "click",
          link_url: redirectUrl,
          user_agent: userAgent,
          ip_address: ipAddress,
        });

      if (error) {
        console.error("Error recording click event:", error);
      } else {
        console.log("Click event recorded successfully");
      }

      // Redirect to original URL
      return new Response(null, {
        status: 302,
        headers: {
          "Location": redirectUrl,
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });

    } else {
      console.error("Invalid tracking type:", type);
      return new Response("Invalid tracking type", { status: 400 });
    }

  } catch (error: any) {
    console.error("Error in email-tracking:", error);
    
    // Still return appropriate response even on error
    if (type === "open") {
      return new Response(TRACKING_PIXEL, {
        headers: { "Content-Type": "image/gif" },
      });
    } else if (type === "click" && redirectUrl) {
      return new Response(null, {
        status: 302,
        headers: { "Location": redirectUrl },
      });
    }
    
    return new Response("Tracking error", { status: 500 });
  }
});
