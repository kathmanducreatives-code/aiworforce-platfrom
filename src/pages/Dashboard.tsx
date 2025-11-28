import { useNavigate } from "react-router-dom";
import ModernDashboard from "@/components/ModernDashboard";

const Dashboard = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Candidate Intelligence Hub */}
      <ModernDashboard />
    </div>
  );
};

export default Dashboard;
