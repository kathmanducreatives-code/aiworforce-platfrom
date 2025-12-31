import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Brain, Mail, Twitter, Linkedin, Github, ArrowRight } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-border/50 bg-card/30 backdrop-blur-sm relative z-10">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
          {/* Brand Column */}
          <div className="lg:col-span-1 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg shadow-primary/20">
                <Brain className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">ScreeningPilot</span>
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              AI-powered recruitment platform that helps you find, screen, and hire top talent faster than ever.
            </p>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-primary/10 hover:text-primary">
                <Twitter className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-primary/10 hover:text-primary">
                <Linkedin className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-primary/10 hover:text-primary">
                <Github className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Product Links */}
          <div className="space-y-4">
            <h4 className="text-foreground font-semibold">Product</h4>
            <ul className="space-y-3">
              <li><Link to="/features" className="text-muted-foreground hover:text-primary transition-colors text-sm">Features</Link></li>
              <li><Link to="/pricing" className="text-muted-foreground hover:text-primary transition-colors text-sm">Pricing</Link></li>
              <li><Link to="/get-demo" className="text-muted-foreground hover:text-primary transition-colors text-sm">Request Demo</Link></li>
              <li><span className="text-muted-foreground text-sm">API Documentation</span></li>
            </ul>
          </div>

          {/* Company Links */}
          <div className="space-y-4">
            <h4 className="text-foreground font-semibold">Company</h4>
            <ul className="space-y-3">
              <li><span className="text-muted-foreground text-sm">About Us</span></li>
              <li><span className="text-muted-foreground text-sm">Careers</span></li>
              <li><span className="text-muted-foreground text-sm">Privacy Policy</span></li>
              <li><span className="text-muted-foreground text-sm">Terms of Service</span></li>
            </ul>
          </div>

          {/* Newsletter */}
          <div className="space-y-4">
            <h4 className="text-foreground font-semibold">Stay Updated</h4>
            <p className="text-muted-foreground text-sm">
              Subscribe to our newsletter for the latest updates and insights.
            </p>
            <div className="flex gap-2">
              <Input 
                type="email" 
                placeholder="Enter your email" 
                className="bg-background/50 border-border/50 focus:border-primary"
              />
              <Button size="icon" className="bg-primary hover:bg-primary/90 shrink-0">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-border/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            © {new Date().getFullYear()} ScreeningPilot. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <span className="text-muted-foreground text-sm hover:text-primary cursor-pointer transition-colors">Privacy</span>
            <span className="text-muted-foreground text-sm hover:text-primary cursor-pointer transition-colors">Terms</span>
            <span className="text-muted-foreground text-sm hover:text-primary cursor-pointer transition-colors">Cookies</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
