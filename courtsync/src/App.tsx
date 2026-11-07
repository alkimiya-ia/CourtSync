import { Navigate, Route, Routes } from 'react-router-dom';
import { configMissing } from './lib/supabase';
import Home from './pages/Home';
import Create from './pages/Create';
import GameRoute, { GameIndex } from './pages/GameRoute';
import Share from './pages/Share';
import Pick from './pages/Pick';
import Live from './pages/Live';
import Score from './pages/Score';
import Box from './pages/Box';

export default function App() {
  if (configMissing) {
    return (
      <div className="app"><div className="center"><div className="col">
        <h2>Configuration missing</h2>
        <p className="muted">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example) and rebuild.</p>
      </div></div></div>
    );
  }
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/g/:code" element={<GameRoute />}>
          <Route index element={<GameIndex />} />
          <Route path="share" element={<Share />} />
          <Route path="pick" element={<Pick />} />
          <Route path="play" element={<Live />} />
          <Route path="score" element={<Score />} />
          <Route path="box" element={<Box />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
