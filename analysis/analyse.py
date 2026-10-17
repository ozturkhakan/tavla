# Runs inside GNU Backgammon (gnubg -t -q -p analyse.py).
# Imports one game from a .mat file, analyses it and writes gnubg's match dict as JSON.
import gnubg, json, os

mat = os.environ["TAVLA_MAT"].replace("\\", "/")
out = os.environ["TAVLA_OUT"]
plies = os.environ.get("TAVLA_PLIES", "2")

gnubg.command("set analysis chequerplay evaluation plies " + plies)
gnubg.command("set analysis cubedecision evaluation plies " + plies)
gnubg.command('import mat "' + mat + '"')
gnubg.command("analyse match")
m = gnubg.match(analysis=1, boards=1, statistics=1)
with open(out, "w") as f:
    json.dump(m, f, default=str)
