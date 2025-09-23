import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Header from "@/components/Header";
import { CheckCircle } from "lucide-react";

const GetDemo = () => {
  const [formData, setFormData] = useState({
    fullName: "",
    workEmail: "",
    companyName: "",
    jobTitle: "",
    message: ""
  });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Here you would typically send the data to your backend
    setSubmitted(true);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50">
      <Header />
      
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-6 max-w-2xl">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent mb-6">
              See ScreeningPilot in Action
            </h1>
            <p className="text-xl text-slate-600 leading-relaxed">
              Book a live demo and discover how our AI-powered recruitment system saves your team 10+ hours per week.
            </p>
          </div>

          <Card className="backdrop-blur-sm bg-white/80 border-slate-200/50 shadow-xl">
            <CardHeader>
              <CardTitle className="text-2xl font-semibold text-slate-800">Request Your Demo</CardTitle>
            </CardHeader>
            <CardContent>
              {!submitted ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="fullName" className="text-slate-700 font-medium">
                        Full Name *
                      </Label>
                      <Input
                        id="fullName"
                        name="fullName"
                        value={formData.fullName}
                        onChange={handleInputChange}
                        required
                        className="border-slate-200 focus:border-cyan-500 focus:ring-cyan-500"
                        placeholder="Enter your full name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workEmail" className="text-slate-700 font-medium">
                        Work Email *
                      </Label>
                      <Input
                        id="workEmail"
                        name="workEmail"
                        type="email"
                        value={formData.workEmail}
                        onChange={handleInputChange}
                        required
                        className="border-slate-200 focus:border-cyan-500 focus:ring-cyan-500"
                        placeholder="your.email@company.com"
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="companyName" className="text-slate-700 font-medium">
                        Company Name
                      </Label>
                      <Input
                        id="companyName"
                        name="companyName"
                        value={formData.companyName}
                        onChange={handleInputChange}
                        className="border-slate-200 focus:border-cyan-500 focus:ring-cyan-500"
                        placeholder="Your company name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="jobTitle" className="text-slate-700 font-medium">
                        Job Title
                      </Label>
                      <Input
                        id="jobTitle"
                        name="jobTitle"
                        value={formData.jobTitle}
                        onChange={handleInputChange}
                        className="border-slate-200 focus:border-cyan-500 focus:ring-cyan-500"
                        placeholder="Your job title"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="message" className="text-slate-700 font-medium">
                      What would you like to see in the demo?
                    </Label>
                    <Textarea
                      id="message"
                      name="message"
                      value={formData.message}
                      onChange={handleInputChange}
                      className="border-slate-200 focus:border-cyan-500 focus:ring-cyan-500 min-h-[120px]"
                      placeholder="Tell us about your specific needs or what you'd like to see during the demo..."
                    />
                  </div>

                  <Button 
                    type="submit" 
                    className="w-full h-12 text-lg font-semibold bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-700 hover:to-teal-700 text-white shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    Request Demo
                  </Button>
                </form>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-semibold text-slate-800 mb-4">
                    Thank you!
                  </h3>
                  <p className="text-lg text-slate-600">
                    Our team will reach out shortly to schedule your demo.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default GetDemo;