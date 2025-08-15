'use client';

import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Box } from '@mui/joy';

export interface ProgressTachoType {
  TotalQuadrats: number;
  PopulatedQuadrats: number;
  PopulatedPercent: number;
  UnpopulatedQuadrats: string[];
}

type TooltipPayload = ReadonlyArray<any>;

type Coordinate = {
  x: number;
  y: number;
};

type PieSectorData = {
  percent?: number;
  name?: string | number;
  midAngle?: number;
  middleRadius?: number;
  tooltipPosition?: Coordinate;
  value?: number;
  paddingAngle?: number;
  dataKey?: string;
  payload?: any;
  tooltipPayload?: ReadonlyArray<TooltipPayload>;
};

type GeometrySector = {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
};

type PieLabelProps = PieSectorData &
  GeometrySector & {
    tooltipPayload?: any;
  };

function getLuminance(hex: string) {
  const c = hex.replace('#', '');
  const rgb = [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)].map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  // Rec. 709 luminance
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function bestTextColor(backgroundHex: string) {
  const luminance = getLuminance(backgroundHex);
  // contrast threshold roughly corresponds to whether background is "dark"
  return luminance < 0.5 ? '#ffffff' : '#222222';
}

const RADIAN = Math.PI / 180;
const COLORS = ['#4D90FE', '#1ABC9C', '#FFC758', '#FF8F5A'];

export default function ProgressPieChart(props: ProgressTachoType) {
  const { TotalQuadrats, PopulatedQuadrats, PopulatedPercent, UnpopulatedQuadrats } = props;

  const data = [
    { name: 'Unpopulated', value: UnpopulatedQuadrats },
    { name: 'Populated', value: PopulatedQuadrats }
  ];
  const renderCustomizedLabel = ({
    cx = 0,
    cy = 0,
    midAngle = 0,
    innerRadius = 0,
    outerRadius = 0,
    percent = 0,
    payload
  }: PieLabelProps & {
    payload?: any;
  }) => {
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent <= 0.001) return null; // skip almost-empty slices

    // determine background color from payload if available
    const fill: string = payload?.fill ?? '#000';
    const fillColor = fill.startsWith('#') ? fill : '#000'; // fallback
    const textColor = bestTextColor(fillColor);

    return (
      <text
        x={x}
        y={y}
        fill={textColor}
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        fontSize={12}
        fontWeight={600}
        style={{
          pointerEvents: 'none',
          textShadow: '0 0 4px rgba(0,0,0,0.6)' // subtle glow to separate from busy backgrounds
        }}
      >
        {`${(percent * 100).toFixed(2)}%`}
      </text>
    );
  };

  return (
    <Box sx={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', width: '100%', height: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" labelLine={false} label={renderCustomizedLabel} outerRadius={80} fill="#8884d8" dataKey="value">
            {data.map((entry, index) => (
              <Cell key={`cell - ${entry.name}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}
