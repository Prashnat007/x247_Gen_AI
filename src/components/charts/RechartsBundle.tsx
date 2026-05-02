// All recharts pieces re-exported from a single module so the lazy
// route-level chunker pulls every chart primitive into one chunk
// (`vendor-recharts`). Pages that need charts wrap the named export they
// want with React.lazy so recharts only ships when a chart actually
// renders, not when the page mounts.
export {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Cell,
  LineChart,
  Line,
  CartesianGrid,
  Area,
  AreaChart,
} from 'recharts';
