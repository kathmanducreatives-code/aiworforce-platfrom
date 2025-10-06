import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Building2, Clock, DollarSign, TrendingUp, Users, Award, Mail, Phone, Calendar } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

interface ClientData {
  id: string;
  client_name: string;
  contact_email: string | null;
  contact_name: string | null;
  industry: string | null;
  created_at: string;
}

interface PlacementData {
  id: string;
  position_title: string;
  placement_date: string;
  time_to_fill_days: number | null;
  cost_per_hire: number | null;
  candidate: {
    candidate_name: string;
    email: string | null;
  } | null;
}

interface ActivePosition {
  id: string;
  position_title: string;
  position_level: string | null;
  posted_date: string;
  status: string;
  required_skills: string[] | null;
}

const ClientDetail = () => {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientData | null>(null);
  const [placements, setPlacements] = useState<PlacementData[]>([]);
  const [activePositions, setActivePositions] = useState<ActivePosition[]>([]);

  useEffect(() => {
    if (clientId) {
      fetchClientDetails();
    }
  }, [clientId]);

  const fetchClientDetails = async () => {
    try {
      setLoading(true);

      // Fetch client data
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

      if (clientError) throw clientError;
      setClient(clientData);

      // Fetch placements with candidate info
      const { data: placementsData, error: placementsError } = await supabase
        .from('client_placements')
        .select(`
          id,
          position_title,
          placement_date,
          time_to_fill_days,
          cost_per_hire,
          candidate:resume_analyses(candidate_name, email)
        `)
        .eq('client_id', clientId)
        .order('placement_date', { ascending: false });

      if (placementsError) throw placementsError;
      setPlacements(placementsData || []);

      // Fetch active positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('client_active_positions')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'open')
        .order('posted_date', { ascending: false });

      if (positionsError) throw positionsError;
      setActivePositions(positionsData || []);

      setLoading(false);
    } catch (error) {
      console.error('Error fetching client details:', error);
      setLoading(false);
    }
  };

  const calculateMetrics = () => {
    const totalPlacements = placements.length;
    const avgTimeToFill = placements.length > 0
      ? Math.round(placements.reduce((sum, p) => sum + (p.time_to_fill_days || 0), 0) / placements.length)
      : 0;
    const avgCostPerHire = placements.length > 0
      ? Math.round(placements.reduce((sum, p) => sum + (Number(p.cost_per_hire) || 0), 0) / placements.length)
      : 0;
    
    return { totalPlacements, avgTimeToFill, avgCostPerHire };
  };

  const metrics = calculateMetrics();

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
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

  if (!client) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-600 mb-4">Client not found</p>
          <Button onClick={() => navigate('/client-metrics')}>
            Back to Client Metrics
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12 animate-fade-in-down">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/client-metrics')}
            className="gap-2 hover:bg-cyan-50 hover:text-cyan-700 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Client Metrics
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-3">
                {client.client_name}
              </h1>
              <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                {client.contact_name && (
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    {client.contact_name}
                  </div>
                )}
                {client.contact_email && (
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4" />
                    {client.contact_email}
                  </div>
                )}
                {client.industry && (
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    {client.industry}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Client since {new Date(client.created_at).toLocaleDateString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-6 md:grid-cols-4 mb-8 animate-fade-in-up">
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl hover-lift">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-500" />
                Total Placements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800">{metrics.totalPlacements}</div>
              <p className="text-sm text-slate-500 mt-1">Successful hires</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl hover-lift animate-delay-100">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-500" />
                Avg. Time-to-Fill
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800">{metrics.avgTimeToFill}</div>
              <p className="text-sm text-slate-500 mt-1">Days on average</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl hover-lift animate-delay-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-purple-500" />
                Avg. Cost Per Hire
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800">
                ${metrics.avgCostPerHire > 0 ? metrics.avgCostPerHire.toLocaleString() : 'N/A'}
              </div>
              <p className="text-sm text-slate-500 mt-1">Per placement</p>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl hover-lift animate-delay-300">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-blue-500" />
                Active Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800">{activePositions.length}</div>
              <p className="text-sm text-slate-500 mt-1">Currently open</p>
            </CardContent>
          </Card>
        </div>

        {/* Active Positions */}
        {activePositions.length > 0 && (
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl mb-8 animate-fade-in-up animate-delay-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-cyan-500" />
                Active Positions
              </CardTitle>
              <CardDescription>Currently open roles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activePositions.map((position) => (
                  <div key={position.id} className="p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h4 className="font-semibold text-slate-800">{position.position_title}</h4>
                        <p className="text-sm text-slate-500">
                          Posted {new Date(position.posted_date).toLocaleDateString()} • 
                          {Math.floor((new Date().getTime() - new Date(position.posted_date).getTime()) / (1000 * 60 * 60 * 24))} days open
                        </p>
                      </div>
                      {position.position_level && (
                        <Badge variant="outline" className="capitalize">
                          {position.position_level}
                        </Badge>
                      )}
                    </div>
                    {position.required_skills && position.required_skills.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {position.required_skills.map((skill, idx) => (
                          <Badge key={idx} className="bg-cyan-100 text-cyan-700 hover:bg-cyan-200">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Placement History */}
        <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl animate-fade-in-up animate-delay-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-emerald-500" />
              Placement History
            </CardTitle>
            <CardDescription>All successful placements for this client</CardDescription>
          </CardHeader>
          <CardContent>
            {placements.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Position</TableHead>
                    <TableHead>Candidate</TableHead>
                    <TableHead>Placement Date</TableHead>
                    <TableHead className="text-center">Time to Fill</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {placements.map((placement) => (
                    <TableRow key={placement.id} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{placement.position_title}</TableCell>
                      <TableCell>
                        {placement.candidate ? (
                          <div>
                            <div className="font-medium text-slate-800">
                              {placement.candidate.candidate_name}
                            </div>
                            {placement.candidate.email && (
                              <div className="text-xs text-slate-500">{placement.candidate.email}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>{new Date(placement.placement_date).toLocaleDateString()}</TableCell>
                      <TableCell className="text-center">
                        {placement.time_to_fill_days ? (
                          <Badge 
                            className={
                              placement.time_to_fill_days <= 21
                                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                                : placement.time_to_fill_days <= 35
                                ? "bg-cyan-100 text-cyan-700 hover:bg-cyan-200"
                                : "bg-orange-100 text-orange-700 hover:bg-orange-200"
                            }
                          >
                            {placement.time_to_fill_days} days
                          </Badge>
                        ) : (
                          <span className="text-slate-400">N/A</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {placement.cost_per_hire 
                          ? `$${Number(placement.cost_per_hire).toLocaleString()}`
                          : <span className="text-slate-400">N/A</span>
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12 text-slate-500">
                <Award className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p>No placements yet for this client</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ClientDetail;