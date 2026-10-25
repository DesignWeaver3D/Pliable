"""Entry point for the frozen build (an absolute import, since PyInstaller runs this file as a script)."""
from pliable.launcher import main

if __name__ == "__main__":
    main()
