import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Star, Shield, ShieldCheck, Search, GraduationCap, Clock, DollarSign } from 'lucide-react';
import { mockExperts, Expert } from './mockData';
import { cn } from '@/lib/utils';

interface ExpertDirectoryProps {
  onRequestExpert: (expert: Expert) => void;
}

const ExpertDirectory = ({ onRequestExpert }: ExpertDirectoryProps) => {
  const [search, setSearch] = useState('');
  const [selectedSpec, setSelectedSpec] = useState<string | null>(null);

  const allSpecs = Array.from(new Set(mockExperts.flatMap(e => e.specializations)));

  const filtered = mockExperts.filter(e => {
    const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) || e.title.toLowerCase().includes(search.toLowerCase());
    const matchesSpec = !selectedSpec || e.specializations.includes(selectedSpec);
    return matchesSearch && matchesSpec;
  });

  return (
    <div className="space-y-6">
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search experts by name or title..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge
          variant={!selectedSpec ? 'default' : 'outline'}
          className="cursor-pointer"
          onClick={() => setSelectedSpec(null)}
        >
          All Skills
        </Badge>
        {allSpecs.map(spec => (
          <Badge
            key={spec}
            variant={selectedSpec === spec ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setSelectedSpec(selectedSpec === spec ? null : spec)}
          >
            {spec}
          </Badge>
        ))}
      </div>

      {/* Expert Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map(expert => (
          <Card key={expert.id} className="group hover:shadow-md transition-shadow">
            <CardContent className="p-5">
              <div className="flex gap-4">
                {/* Avatar */}
                <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center text-lg font-bold text-primary flex-shrink-0">
                  {expert.name.split(' ').map(n => n[0]).join('')}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">{expert.name}</h3>
                        {expert.verified && (
                          <ShieldCheck className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{expert.title}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs flex-shrink-0',
                        expert.availability === 'Available'
                          ? 'border-green-500/30 text-green-600 bg-green-500/10'
                          : 'border-yellow-500/30 text-yellow-600 bg-yellow-500/10'
                      )}
                    >
                      {expert.availability}
                    </Badge>
                  </div>

                  {/* Stats Row */}
                  <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500" />
                      <span className="font-medium text-foreground">{expert.qualityScore}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {expert.yearsExperience}y exp
                    </span>
                    <span className="flex items-center gap-1">
                      <DollarSign className="h-3.5 w-3.5" />
                      ${expert.hourlyRate}/hr
                    </span>
                    <span>{expert.totalInterviews} interviews</span>
                  </div>

                  {/* Degree */}
                  <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                    <GraduationCap className="h-3.5 w-3.5" />
                    <span>{expert.degree} — {expert.university}</span>
                    {expert.degreeVerified && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/30 text-green-600 bg-green-500/5">
                        Verified
                      </Badge>
                    )}
                  </div>

                  {/* Skills */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {expert.specializations.map(s => (
                      <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    <p className="text-xs text-muted-foreground line-clamp-1 flex-1 mr-3">{expert.bio}</p>
                    <Button
                      size="sm"
                      onClick={() => onRequestExpert(expert)}
                      disabled={!expert.verified}
                    >
                      {expert.verified ? 'Request Expert' : 'Not Verified'}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default ExpertDirectory;
