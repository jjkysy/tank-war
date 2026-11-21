import { Route, Switch } from "wouter";
import Protected from "./_core/Protected";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Play from "./pages/Play";
import Leaderboard from "./pages/Leaderboard";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/play">
        <Protected>
          <Play />
        </Protected>
      </Route>
      <Route path="/profile">
        <Protected>
          <Profile />
        </Protected>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}
