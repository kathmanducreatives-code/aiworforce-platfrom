import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Clock, DollarSign, TrendingUp, Award } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface ClientMetric {
  clientName: string;
  placements: number;
  avgTimeToFill: number;
  costPerHire: number;
  activePositions: number;
}

const ClientMetrics = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [clients, setClients] = useState<ClientMetric[]>([
    {
      clientName: "Tech Corp Solutions",
      placements: 12,
      avgTimeToFill: 21,
      costPerHire: 3500,
      activePositions: 5
    },
    {
      clientName: "Digital Innovations Ltd",
      placements: 8,
      avgTimeToFill: 28,
      costPerHire: 4200,
      activePositions: 3
    },
    {
      clientName: "Global Systems Inc",
      placements: 15,
      avgTimeToFill: 18,
      costPerHire: 3200,
      activePositions: 7
    },
    {
      clientName: "Future Tech Partners",
      placements: 6,
      avgTimeToFill: 35,
      costPerHire: 4800,
      activePositions: 2
    },
    {
      clientName: "Enterprise Solutions Group",
      placements: 10,
      avgTimeToFill: 24,
      costPerHire: 3900,
      activePositions: 4
    }
  ]);

  const totalPlacements = clients.reduce((sum, client) => sum + client.placements, 0);
  const avgTimeToFillAll = Math.round(
    clients.reduce((sum, client) => sum + client.avgTimeToFill, 0) / clients.length
  );
  const avgCostPerHire = Math.round(
    clients.reduce((sum, client) => sum + client.costPerHire, 0) / clients.length
  );
  const totalActivePositions = clients.reduce((sum, client) => sum + client.activePositions, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-white">
      <div className="max-w-7xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/data-dashboard')}
                  className="gap-2 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Analytics
                </Button>
              </div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-3">
                Client-Centric Metrics
              </h1>
              <p className="text-slate-600 text-lg font-medium">
                Track performance and outcomes across all client relationships
              </p>
            </div>
          </div>
        </div>

        {/* Top KPI Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Award className="h-4 w-4 text-emerald-500" />
                Total Placements
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{totalPlacements}</div>
              <p className="text-sm text-slate-500">Across {clients.length} clients</p>
              <div className="mt-3">
                <Progress value={(totalPlacements / (clients.length * 15)) * 100} className="h-2" />
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-500" />
                Avg. Time-to-Fill
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{avgTimeToFillAll}</div>
              <p className="text-sm text-slate-500">Days from opening to placement</p>
              <div className="mt-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-600">12% faster than industry avg</span>
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-purple-500" />
                Avg. Cost Per Hire
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">${avgCostPerHire.toLocaleString()}</div>
              <p className="text-sm text-slate-500">Per successful placement</p>
              <Badge className="mt-3 bg-purple-100 text-purple-700 hover:bg-purple-200">
                Placeholder metric
              </Badge>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg hover:shadow-xl transition-all duration-300 rounded-2xl overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <Building2 className="h-4 w-4 text-blue-500" />
                Active Positions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-slate-800 mb-2">{totalActivePositions}</div>
              <p className="text-sm text-slate-500">Currently being filled</p>
              <div className="mt-3">
                <span className="text-sm font-medium text-blue-600">
                  {clients.filter(c => c.activePositions > 0).length} clients with open roles
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Client Performance Table */}
        <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-cyan-500" />
              Client Performance Overview
            </CardTitle>
            <CardDescription>Detailed metrics for each client relationship</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client Name</TableHead>
                  <TableHead className="text-center">Placements</TableHead>
                  <TableHead className="text-center">Avg. Time-to-Fill</TableHead>
                  <TableHead className="text-center">Cost Per Hire</TableHead>
                  <TableHead className="text-center">Active Positions</TableHead>
                  <TableHead className="text-center">Performance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.map((client, index) => (
                  <TableRow key={index} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        {client.clientName}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold text-emerald-600">{client.placements}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span className={client.avgTimeToFill <= 21 ? "text-emerald-600 font-medium" : "text-slate-600"}>
                          {client.avgTimeToFill} days
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-medium text-slate-700">
                        ${client.costPerHire.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={client.activePositions > 0 ? "border-blue-300 text-blue-700" : ""}>
                        {client.activePositions}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge 
                        className={
                          client.avgTimeToFill <= 21 && client.placements >= 10
                            ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                            : client.placements >= 8
                            ? "bg-cyan-100 text-cyan-700 hover:bg-cyan-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                        }
                      >
                        {client.avgTimeToFill <= 21 && client.placements >= 10
                          ? "Excellent"
                          : client.placements >= 8
                          ? "Good"
                          : "Developing"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Additional Insights */}
        <div className="grid gap-6 lg:grid-cols-2 mt-8">
          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
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
                    <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                          index === 0 ? 'bg-amber-100 text-amber-700' :
                          index === 1 ? 'bg-slate-200 text-slate-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {index + 1}
                        </div>
                        <span className="text-sm font-medium text-slate-700">{client.clientName}</span>
                      </div>
                      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                        {client.placements} placements
                      </Badge>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>

          <Card className="backdrop-blur-sm bg-white/80 border border-slate-200/50 shadow-lg rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-cyan-500" />
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
                    <div key={index} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <span className="text-sm font-medium text-slate-700">{client.clientName}</span>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-cyan-500" />
                        <span className="text-sm font-semibold text-cyan-600">{client.avgTimeToFill} days</span>
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
