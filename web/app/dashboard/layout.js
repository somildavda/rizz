import { SuiteShell } from "../../components/Suite";
export const metadata = { title: "Dashboard", robots: { index: false } };
export default function DashboardLayout({ children }) {
  return <SuiteShell>{children}</SuiteShell>;
}
