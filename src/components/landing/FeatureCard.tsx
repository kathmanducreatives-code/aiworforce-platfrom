import { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  delay?: number;
}

const FeatureCard = ({ icon: Icon, title, description, delay = 0 }: FeatureCardProps) => {
  return (
    <Card 
      className="glass-card hover-lift border-border/20 backdrop-blur-sm bg-card/50"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="p-6 space-y-4">
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center animate-scale-in">
          <Icon className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-xl font-semibold text-foreground">{title}</h3>
        <p className="text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

export default FeatureCard;
