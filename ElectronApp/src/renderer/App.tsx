import { Routes, Route } from 'react-router-dom';
import Nav from './Nav';
import DataEntry from './routes/data-entry';
import DataReports from './routes/data-reports';
import FieldForms from './routes/field-forms';

export default function App() {
  return (
    <div>
      <h1>ForestGEO App</h1>
      <Nav />
      <Routes>
        <Route path="data-entry" element={<DataEntry />} />
        <Route path="data-reports" element={<DataReports />} />
        <Route path="field-forms" element={<FieldForms />} />
      </Routes>
    </div>
  );
}
