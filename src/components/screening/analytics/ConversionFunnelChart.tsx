import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FunnelData {
    stage: string;
    count: number;
    fill: string;
}

interface ConversionFunnelChartProps {
    data: FunnelData[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-background border border-border p-2 rounded-md shadow-md text-xs">
                <p className="font-semibold">{label}</p>
                <p className="text-primary">{`${payload[0].value} candidates`}</p>
            </div>
        );
    }
    return null;
};

export const ConversionFunnelChart = ({ data }: ConversionFunnelChartProps) => {
    return (
        <Card className="col-span-1 md:col-span-2">
            <CardHeader>
                <CardTitle className="text-base font-medium">Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                        <XAxis type="number" hide />
                        <YAxis
                            dataKey="stage"
                            type="category"
                            axisLine={false}
                            tickLine={false}
                            width={100}
                            className="text-xs text-muted-foreground font-medium"
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={32}>
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.fill} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};
