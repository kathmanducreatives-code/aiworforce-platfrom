import { Calendar, Check, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';

const GoogleCalendarConnect = () => {
  const { isConnected, isLoading, connect, disconnect } = useGoogleCalendar();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-primary" />
            Google Calendar
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Google Calendar
        </CardTitle>
        <CardDescription>
          Sync interviews with your Google Calendar and auto-generate Google Meet links
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isConnected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <Check className="h-5 w-5" />
              <span className="font-medium">Connected</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Your interviews will automatically sync to your Google Calendar. 
              Google Meet links will be generated for video interviews.
            </p>
            <Button 
              variant="outline" 
              onClick={disconnect}
              className="gap-2"
            >
              <Unlink className="h-4 w-4" />
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Connect your Google Calendar to automatically create calendar events 
              and generate Google Meet links for video interviews.
            </p>
            <Button onClick={connect} className="gap-2">
              <Calendar className="h-4 w-4" />
              Connect Google Calendar
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default GoogleCalendarConnect;
