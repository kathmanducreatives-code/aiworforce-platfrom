import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sparkles } from "lucide-react";

interface Token {
  name: string;
  value: string;
  description: string;
}

interface TokenPickerProps {
  onTokenSelect: (token: string) => void;
}

const tokens: Token[] = [
  { name: "Candidate Name", value: "{{candidateName}}", description: "Full name" },
  { name: "First Name", value: "{{firstName}}", description: "First name only" },
  { name: "Email", value: "{{email}}", description: "Email address" },
  { name: "Fit Score", value: "{{fitScore}}", description: "Candidate fit score" },
  { name: "Folder Name", value: "{{folderName}}", description: "Position/folder name" },
  { name: "Company Name", value: "{{companyName}}", description: "Your company name" },
  { name: "Sender Name", value: "{{senderName}}", description: "Your name" },
];

const TokenPicker = ({ onTokenSelect }: TokenPickerProps) => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Sparkles className="h-4 w-4" />
          Insert Token
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="p-2">
          <h4 className="font-semibold text-sm mb-2 px-2">Personalization Tokens</h4>
          <div className="space-y-1">
            {tokens.map((token) => (
              <button
                key={token.value}
                onClick={() => onTokenSelect(token.value)}
                className="w-full text-left px-2 py-2 rounded-md hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{token.name}</p>
                    <p className="text-xs text-muted-foreground">{token.description}</p>
                  </div>
                  <code className="text-xs bg-muted px-2 py-1 rounded">
                    {token.value}
                  </code>
                </div>
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default TokenPicker;
