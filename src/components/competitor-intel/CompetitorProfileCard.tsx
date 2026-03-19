import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Star } from 'lucide-react';

interface Competitor {
  id: string;
  company_name: string;
}

interface CompetitorProfile {
  tagline: string | null;
  value_proposition: string | null;
  pricing_model: string | null;
  pricing_tiers: any;
  key_features: any;
  total_employees_estimate: number | null;
  engineering_headcount_estimate: number | null;
  recent_executive_changes: any;
  g2_rating: number | null;
  g2_review_count: number | null;
  top_praise: any;
  top_complaints: any;
  last_full_scan_at: string | null;
  recent_launches: any;
}

interface CompetitorSignal {
  signal_type: string;
  signal_title: string;
  created_at: string;
}

interface Props {
  competitor: Competitor;
  profile: CompetitorProfile | null;
  signals: CompetitorSignal[];
  onRescan: () => void;
}

const CompetitorProfileCard = ({ competitor, profile, signals, onRescan }: Props) => {
  const features = Array.isArray(profile?.key_features) ? profile.key_features : [];
  const praise = Array.isArray(profile?.top_praise) ? profile.top_praise : [];
  const complaints = Array.isArray(profile?.top_complaints) ? profile.top_complaints : [];
  const recentMoves = signals.slice(0, 3);

  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5 transition-all hover:border-primary/20">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-foreground uppercase tracking-wide">{competitor.company_name} — Full Profile</h3>
          {profile?.last_full_scan_at && (
            <p className="text-xs text-muted-foreground">Last scanned: {new Date(profile.last_full_scan_at).toLocaleDateString()}</p>
          )}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 text-xs rounded-lg" onClick={onRescan}>
          <RefreshCw className="h-3 w-3" /> Rescan
        </Button>
      </div>

      <div className="space-y-4">
        {/* Positioning */}
        {(profile?.tagline || profile?.value_proposition) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Positioning</p>
            <p className="text-sm text-foreground italic">&ldquo;{profile.tagline || profile.value_proposition}&rdquo;</p>
          </div>
        )}

        {/* Pricing */}
        {profile?.pricing_tiers && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Pricing</p>
            <p className="text-sm text-foreground">
              {Array.isArray(profile.pricing_tiers) ? profile.pricing_tiers.map((t: any) => `${t.name || 'Tier'} ${t.price || ''}`).join(' · ') : 'See pricing page'}
            </p>
          </div>
        )}

        {/* Features */}
        {features.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Key Features</p>
            <div className="flex flex-wrap gap-1.5">
              {features.slice(0, 8).map((f: string, i: number) => (
                <Badge key={i} variant="secondary" className="text-[10px] rounded-md">{f}</Badge>
              ))}
            </div>
          </div>
        )}

        {/* Hiring */}
        {(profile?.total_employees_estimate || profile?.engineering_headcount_estimate) && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Hiring Right Now</p>
            <p className="text-sm text-foreground">
              {profile.engineering_headcount_estimate ? `${profile.engineering_headcount_estimate} Engineering roles` : ''}
              {profile.total_employees_estimate ? ` · ~${profile.total_employees_estimate} total employees` : ''}
            </p>
          </div>
        )}

        {/* Sentiment */}
        {profile?.g2_rating && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Customer Sentiment</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className={`h-3.5 w-3.5 ${i < Math.floor(profile.g2_rating!) ? 'text-yellow-500 fill-yellow-500' : 'text-muted-foreground/30'}`} />
                ))}
              </div>
              <span className="text-sm text-foreground">{profile.g2_rating}</span>
              {profile.g2_review_count && (
                <span className="text-xs text-muted-foreground">({profile.g2_review_count} reviews)</span>
              )}
            </div>
            {praise.length > 0 && <p className="text-xs text-muted-foreground mt-1">Top praise: {praise.slice(0, 3).join(', ')}</p>}
            {complaints.length > 0 && <p className="text-xs text-muted-foreground">Top complaints: {complaints.slice(0, 3).join(', ')}</p>}
          </div>
        )}

        {/* Recent moves */}
        {recentMoves.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recent Moves</p>
            <ul className="space-y-1">
              {recentMoves.map((s, i) => (
                <li key={i} className="text-xs text-muted-foreground">· {s.signal_title}</li>
              ))}
            </ul>
          </div>
        )}

        {!profile && (
          <p className="text-sm text-muted-foreground italic">No profile data yet. Run a scan to populate.</p>
        )}
      </div>
    </div>
  );
};

export default CompetitorProfileCard;
