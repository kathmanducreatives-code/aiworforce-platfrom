import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Building2, Clock, DollarSign, TrendingUp, Award, ExternalLink, Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";

interface ClientMetric {
  id: string;
  clientName: string;
  placements: number;
  avgTimeToFill: number;
  costPerHire: number;
  activePositions: number;
}

const ClientMetrics = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<ClientMetric[]>([]);

  useEffect(() => {
    fetchClientMetrics();
  }, []);

  const fetchClientMetrics = async () => {
    try {
      setLoading(true);
      
      // Fetch all clients
      const { data: clientsData, error: clientsError } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: false });

      if (clientsError) throw clientsError;

      if (!clientsData || clientsData.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch placements and active positions for each client
      const clientMetrics = await Promise.all(
        clientsData.map(async (client) => {
          // Get placements count and metrics
          const { data: placementsData, error: placementsError } = await supabase
            .from('client_placements')
            .select('time_to_fill_days, cost_per_hire')
            .eq('client_id', client.id);

          if (placementsError) throw placementsError;

          // Get active positions count
          const { count: activeCount, error: activeError } = await supabase
            .from('client_active_positions')
            .select('*', { count: 'exact', head: true })
            .eq('client_id', client.id)
            .eq('status', 'open');

          if (activeError) throw activeError;

          // Calculate metrics
          const placements = placementsData?.length || 0;
          const avgTimeToFill = placements > 0
            ? Math.round(
                placementsData.reduce((sum, p) => sum + (p.time_to_fill_days || 0), 0) / placements
              )
            : 0;
          const costPerHire = placements > 0
            ? Math.round(
                placementsData.reduce((sum, p) => sum + (Number(p.cost_per_hire) || 0), 0) / placements
              )
            : 0;

          return {
            id: client.id,
            clientName: client.client_name,
            placements,
            avgTimeToFill,
            costPerHire,
            activePositions: activeCount || 0,
          };
        })
      );

      setClients(clientMetrics);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching client metrics:', error);
      toast({
        title: "Error",
        description: "Failed to load client metrics. Please try again.",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const totalPlacements = clients.reduce((sum, client) => sum + client.placements, 0);
  const avgTimeToFillAll = clients.length > 0
    ? Math.round(clients.reduce((sum, client) => sum + client.avgTimeToFill, 0) / clients.length)
    : 0;
  const avgCostPerHire = clients.length > 0
    ? Math.round(clients.reduce((sum, client) => sum + client.costPerHire, 0) / clients.length)
    : 0;
  const totalActivePositions = clients.reduce((sum, client) => sum + client.activePositions, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <Skeleton className="h-12 w-64 mb-8" />
          <div className="grid gap-6 md:grid-cols-4 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12 animate-fade-in-down">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/data-dashboard')}
                  className="gap-2 hover:bg-muted hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Analytics
                </Button>
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent mb-3">
                Client-Centric Metrics
              </h1>
              <p className="text-muted-foreground text-lg font-medium">
                Track performance and outcomes across all client relationships
              </p>
            </div>
            <Button
              onClick={fetchClientMetrics}
              variant="outline"
              className="gap-2"
            >
              <TrendingUp className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden hover-lift animate-fade-in-up group">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
                  <Award className="h-4 w-4 text-primary" />
                </div>
                Total Placements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary mb-2">
                {totalPlacements}
              </div>
              <p className="text-sm text-muted-foreground">Across {clients.length} client{clients.length !== 1 ? 's' : ''}</p>
              <div className="mt-3">
                <Progress
                  value={clients.length > 0 ? (totalPlacements / (clients.length * 15)) * 100 : 0}
                  className="h-2"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden hover-lift animate-fade-in-up animate-delay-100 group">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
                  <Clock className="h-4 w-4 text-primary" />
                </div>
                Avg. Time-to-Fill
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-2">
                <div className="text-3xl font-bold text-primary">
                  {avgTimeToFillAll}
                </div>
                <span className="text-sm text-muted-foreground">days</span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">Opening to placement</p>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg">
                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium text-primary">Fast turnaround</span>
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden hover-lift animate-fade-in-up animate-delay-200 group">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
                  <DollarSign className="h-4 w-4 text-primary" />
                </div>
                Avg. Cost Per Hire
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary mb-2">
                ${avgCostPerHire > 0 ? avgCostPerHire.toLocaleString() : 'N/A'}
              </div>
              <p className="text-sm text-muted-foreground">Per placement</p>
              {avgCostPerHire === 0 && (
                <Badge className="mt-3 bg-muted text-muted-foreground hover:bg-muted/80">
                  No data yet
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm hover:shadow-md transition-all duration-300 rounded-2xl overflow-hidden hover-lift animate-fade-in-up animate-delay-300 group">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <div className="p-2 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                Active Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary mb-2">
                {totalActivePositions}
              </div>
              <p className="text-sm text-muted-foreground mb-2">Currently open</p>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 rounded-lg">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span className="text-sm font-medium text-primary">
                  {clients.filter(c => c.activePositions > 0).length} clients hiring
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Client Performance Table */}
        <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm rounded-2xl animate-fade-in-up animate-delay-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Client Performance Overview
            </CardTitle>
            <CardDescription>Click on any client to view detailed breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {clients.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client Name</TableHead>
                    <TableHead className="text-center">Placements</TableHead>
                    <TableHead className="text-center">Avg. Time-to-Fill</TableHead>
                    <TableHead className="text-center">Cost Per Hire</TableHead>
                    <TableHead className="text-center">Active Positions</TableHead>
                    <TableHead className="text-center">Performance</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow
                      key={client.id}
                      className="hover:bg-muted/40 cursor-pointer transition-colors group"
                      onClick={() => navigate(`/client/${client.id}`)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <div className="p-2 bg-muted rounded-lg group-hover:bg-primary/10 transition-colors">
                            <Building2 className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                          </div>
                          <span className="group-hover:text-primary transition-colors">{client.clientName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-semibold text-primary">{client.placements}</span>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className={client.avgTimeToFill <= 21 && client.avgTimeToFill > 0 ? "text-primary font-medium" : "text-muted-foreground"}>
                            {client.avgTimeToFill > 0 ? `${client.avgTimeToFill} days` : 'N/A'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="font-medium text-foreground">
                          {client.costPerHire > 0 ? `$${client.costPerHire.toLocaleString()}` : 'N/A'}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={client.activePositions > 0 ? "border-primary/40 text-primary bg-primary/10" : ""}>
                          {client.activePositions}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          className={
                            client.avgTimeToFill <= 21 && client.placements >= 10
                              ? "bg-primary/20 text-primary hover:bg-primary/25"
                              : client.placements >= 8
                              ? "bg-primary/15 text-primary hover:bg-primary/20"
                              : client.placements > 0
                              ? "bg-primary/10 text-primary hover:bg-primary/15"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }
                        >
                          {client.avgTimeToFill <= 21 && client.placements >= 10
                            ? "Excellent"
                            : client.placements >= 8
                            ? "Good"
                            : client.placements > 0
                            ? "Developing"
                            : "New"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/client/${client.id}`);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                          View Details
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-12 w-12 mx-auto mb-3 text-muted-foreground/60" />
                <p className="mb-4">No clients found</p>
                <p className="text-sm">Add clients to start tracking metrics</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Additional Insights */}
        <div className="grid gap-6 lg:grid-cols-2 mt-8">
          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Top Performing Clients
              </CardTitle>
              <CardDescription>Based on total placements</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {clients
                  .sort((a, b) => b.placements - a.placements)
                  .slice(0, 3)
                  .map((client, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-amber-500/15 text-amber-500' :
                          index === 1 ? 'bg-muted text-foreground' :
                          'bg-orange-500/15 text-orange-500'
                        }`}>
                          {index + 1}
                        </div>
                        <span className="text-sm font-medium text-foreground">{client.clientName}</span>
                      </div>
                      <Badge className="bg-primary/15 text-primary hover:bg-primary/20">
                        {client.placements} placements
                      </Badge>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-card/90 border border-border/60 shadow-sm rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                Fastest Time-to-Fill
              </CardTitle>
              <CardDescription>Most efficient placement processes</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {clients
                  .sort((a, b) => a.avgTimeToFill - b.avgTimeToFill)
                  .slice(0, 3)
                  .map((client, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted/40 rounded-lg">
                      <span className="text-sm font-medium text-foreground">{client.clientName}</span>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold text-primary">{client.avgTimeToFill} days</span>
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default ClientMetrics;
