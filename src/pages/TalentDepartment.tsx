import DepartmentHeader from '@/components/departments/DepartmentHeader';
import Dashboard from './Dashboard';

const TalentDepartment = () => {
  return (
    <div className="min-h-screen bg-transparent">
      <div className="max-w-[1280px] mx-auto px-6 lg:px-8 pt-6">
        <DepartmentHeader departmentId="talent" />
      </div>
      {/* Render existing dashboard content below header */}
      <Dashboard />
    </div>
  );
};

export default TalentDepartment;
