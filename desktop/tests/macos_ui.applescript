-- Acts on one running program through the macOS accessibility system, for the shell tests (macos_ui.py calls this).
-- Usage: osascript macos_ui.applescript PID VERB [ARGUMENTS]. Prints one line of result; lists are separated by tabs.
on run argv
  set thePid to (item 1 of argv) as integer
  set verb to item 2 of argv
  tell application "System Events"
    set p to first process whose unix id is thePid
    if verb is "titles" then
      return my joined(name of every window of p)
    else if verb is "buttons" then
      set found to {}
      repeat with i from 1 to (count of windows of p)
        set els to entire contents of window i of p
        repeat with e in els
          try
            if role of e is "AXButton" then set end of found to (name of e as text)
          end try
        end repeat
      end repeat
      return my joined(found)
    else if verb is "press" then
      set wanted to item 3 of argv
      repeat with i from 1 to (count of windows of p)
        set els to entire contents of window i of p
        repeat with e in els
          try
            if role of e is "AXButton" and (name of e as text) is wanted then
              click e
              return "pressed"
            end if
          end try
        end repeat
      end repeat
      return "missing"
    else if verb is "menu" then
      click menu item (item 4 of argv) of menu 1 of menu bar item (item 3 of argv) of menu bar 1 of p
      return "chosen"
    else if verb is "close" then
      click (first button of window 1 of p whose subrole is "AXCloseButton")
      return "closed"
    else if verb is "sheet" then
      if (count of sheets of window 1 of p) is 0 then return "none"
      set s to sheet 1 of window 1 of p
      return "buttons" & tab & my joined(name of every button of s) & linefeed & "texts" & tab & my joined(value of every static text of s)
    else if verb is "sheetpress" then
      click button (item 3 of argv) of sheet 1 of window 1 of p
      return "pressed"
    end if
  end tell
  error "Unknown verb: " & verb
end run

on joined(parts)
  set saved to AppleScript's text item delimiters
  set AppleScript's text item delimiters to tab
  set out to parts as text
  set AppleScript's text item delimiters to saved
  return out
end joined
