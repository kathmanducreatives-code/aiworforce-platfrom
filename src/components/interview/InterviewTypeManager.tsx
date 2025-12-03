import { useState } from 'react';
import { Plus, Edit, Trash2, Video, Phone, MapPin, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InterviewType, InterviewLocationType, LOCATION_TYPE_LABELS } from '@/types/Interview';
import { Skeleton } from '@/components/ui/skeleton';

interface InterviewTypeManagerProps {
  interviewTypes: InterviewType[];
  loading: boolean;
  onCreate: (data: Partial<InterviewType>) => Promise<InterviewType | null>;
  onUpdate: (id: string, data: Partial<InterviewType>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const InterviewTypeManager = ({
  interviewTypes,
  loading,
  onCreate,
  onUpdate,
  onDelete,
}: InterviewTypeManagerProps) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<InterviewType | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    duration_minutes: 30,
    description: '',
    location_type: 'video' as InterviewLocationType,
    meeting_link_template: '',
    buffer_minutes: 15,
  });
  const [isSaving, setIsSaving] = useState(false);

  const getLocationIcon = (locationType: InterviewLocationType) => {
    switch (locationType) {
      case 'video':
        return <Video className="h-4 w-4" />;
      case 'phone':
        return <Phone className="h-4 w-4" />;
      default:
        return <MapPin className="h-4 w-4" />;
    }
  };

  const openCreateDialog = () => {
    setEditingType(null);
    setFormData({
      name: '',
      duration_minutes: 30,
      description: '',
      location_type: 'video',
      meeting_link_template: '',
      buffer_minutes: 15,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (type: InterviewType) => {
    setEditingType(type);
    setFormData({
      name: type.name,
      duration_minutes: type.duration_minutes,
      description: type.description || '',
      location_type: type.location_type,
      meeting_link_template: type.meeting_link_template || '',
      buffer_minutes: type.buffer_minutes || 15,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      if (editingType) {
        await onUpdate(editingType.id, formData);
      } else {
        await onCreate(formData);
      }
      setIsDialogOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Interview Types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="bg-card border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">Interview Types</CardTitle>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Type
          </Button>
        </CardHeader>
        <CardContent>
          {interviewTypes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No interview types configured</p>
              <p className="text-sm mt-1">Create your first interview type</p>
              <Button className="mt-4" variant="outline" onClick={openCreateDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Create Interview Type
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {interviewTypes.map((type) => (
                <div
                  key={type.id}
                  className="p-4 rounded-lg border border-border bg-background flex items-center justify-between"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-foreground">{type.name}</span>
                      <Badge variant="outline" className="flex items-center gap-1">
                        {getLocationIcon(type.location_type)}
                        {LOCATION_TYPE_LABELS[type.location_type]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{type.duration_minutes} min</span>
                      </div>
                      {type.buffer_minutes && (
                        <span>{type.buffer_minutes} min buffer</span>
                      )}
                    </div>
                    {type.description && (
                      <p className="text-sm text-muted-foreground mt-1">{type.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(type)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(type.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingType ? 'Edit Interview Type' : 'Create Interview Type'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Phone Screen, Technical Interview"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Select
                  value={formData.duration_minutes.toString()}
                  onValueChange={(v) =>
                    setFormData({ ...formData, duration_minutes: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                    <SelectItem value="45">45 min</SelectItem>
                    <SelectItem value="60">60 min</SelectItem>
                    <SelectItem value="90">90 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buffer">Buffer (minutes)</Label>
                <Select
                  value={formData.buffer_minutes.toString()}
                  onValueChange={(v) =>
                    setFormData({ ...formData, buffer_minutes: parseInt(v) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">No buffer</SelectItem>
                    <SelectItem value="5">5 min</SelectItem>
                    <SelectItem value="10">10 min</SelectItem>
                    <SelectItem value="15">15 min</SelectItem>
                    <SelectItem value="30">30 min</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location_type">Location Type</Label>
              <Select
                value={formData.location_type}
                onValueChange={(v) =>
                  setFormData({ ...formData, location_type: v as InterviewLocationType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video Call</SelectItem>
                  <SelectItem value="phone">Phone Call</SelectItem>
                  <SelectItem value="in_person">In Person</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {formData.location_type === 'video' && (
              <div className="space-y-2">
                <Label htmlFor="meeting_link">Meeting Link Template</Label>
                <Input
                  id="meeting_link"
                  value={formData.meeting_link_template}
                  onChange={(e) =>
                    setFormData({ ...formData, meeting_link_template: e.target.value })
                  }
                  placeholder="e.g., https://zoom.us/j/..."
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description of this interview type"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!formData.name || isSaving}>
              {isSaving ? 'Saving...' : editingType ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default InterviewTypeManager;
