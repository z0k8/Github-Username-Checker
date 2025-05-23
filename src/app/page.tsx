
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import { Play, StopCircle, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";

type LogMessage = {
  id: string;
  text: string;
  type: "info" | "success" | "error" | "accent" | "muted";
};

type AvailableUsername = {
  timestamp: string;
  username: string;
};

const GITHUB_API_BASE_URL = "https://api.github.com/users/";
const MIN_USERNAME_LENGTH = 1; // GitHub's actual min length
const MAX_USERNAME_LENGTH = 39;
const USER_INPUT_MIN_LENGTH = 3; // As per prompt

export default function GitHunterPage() {
  const [usernameLength, setUsernameLength] = useState<string>("3");
  const [excludeNumbers, setExcludeNumbers] = useState<boolean>(false);
  const [specificNumbersToExclude, setSpecificNumbersToExclude] = useState<string>("");
  const [isHunting, setIsHunting] = useState<boolean>(false);
  const [availableUsernames, setAvailableUsernames] = useState<AvailableUsername[]>([]);
  const [logMessages, setLogMessages] = useState<LogMessage[]>([]);
  const [stats, setStats] = useState<{ attempts: number; available: number; taken: number }>({
    attempts: 0,
    available: 0,
    taken: 0,
  });
  const [isThrottled, setIsThrottled] = useState<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const addLog = useCallback((text: string, type: LogMessage["type"] = "info") => {
    setLogMessages((prevLogs) => [...prevLogs, { id: crypto.randomUUID(), text, type }]);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logMessages]);

  const generateUsername = (length: number): string => {
    let availableChars = "abcdefghijklmnopqrstuvwxyz";
    if (!excludeNumbers) {
      let numbersToInclude = "0123456789";
      if (specificNumbersToExclude.trim() !== "") {
        const excludedDigits = specificNumbersToExclude
          .split(',')
          .map(d => d.trim())
          .filter(d => d.length === 1 && "0123456789".includes(d));
        
        excludedDigits.forEach(digit => {
          numbersToInclude = numbersToInclude.replace(new RegExp(digit, 'g'), "");
        });
      }
      availableChars += numbersToInclude;
    }

    if (availableChars.length === 0) {
      // This should ideally be caught by pre-validation in handleStartHunting
      addLog("Internal Error: No characters available for username generation. Adjust settings.", "error");
      return "ERROR_NO_CHARS"; 
    }

    let result = "";
    for (let i = 0; i < length; i++) {
      result += availableChars.charAt(Math.floor(Math.random() * availableChars.length));
    }
    return result;
  };

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const checkUsernameAvailability = async (username: string, signal: AbortSignal): Promise<"available" | "taken" | "throttled" | "error" | "aborted"> => {
    try {
      const response = await fetch(`${GITHUB_API_BASE_URL}${username}`, { signal });
      if (response.status === 404) return "available";
      if (response.status === 200) return "taken";
      if (response.status === 403 || response.status === 429) return "throttled";
      addLog(`Unexpected status code ${response.status} for ${username}`, "error");
      return "error";
    } catch (error: any) {
      if (error.name === 'AbortError') {
        return "aborted";
      }
      addLog(`Request failed for ${username}: ${error.message}`, "error");
      return "error";
    }
  };

  const huntUsernames = async (length: number) => {
    setIsLoading(true);
    setIsHunting(true);
    // Clear logs for new hunt, but keep availableUsernames unless user explicitly clears them.
    setLogMessages([]); 
    setStats({ attempts: 0, available: 0, taken: 0 });
    addLog(`Starting hunt for usernames of length ${length}...`, "info");

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    let currentAttempts = 0;
    let currentAvailable = 0;
    let currentTaken = 0;

    try {
      while (!signal.aborted) {
        if (isThrottled) {
          addLog("Rate limit likely hit. Pausing for 60 seconds...", "error");
          await delay(60000); // Wait 60 seconds
          setIsThrottled(false);
          addLog("Resuming hunt...", "info");
          if (signal.aborted) break;
        }

        const username = generateUsername(length);
        if (username === "ERROR_NO_CHARS") {
            addLog("Stopping hunt: No characters available for generation based on current settings.", "error");
            if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
                abortControllerRef.current.abort();
            }
            break;
        }
        
        currentAttempts++;
        addLog(`Checking: ${username}`, "muted");
        setStats({ attempts: currentAttempts, available: currentAvailable, taken: currentTaken });

        const result = await checkUsernameAvailability(username, signal);

        if (signal.aborted) {
          addLog("Hunt aborted by user.", "info");
          break;
        }
        
        switch (result) {
          case "available":
            currentAvailable++;
            const timestamp = format(new Date(), "yyyy-MM-dd HH:mm:ss");
            setAvailableUsernames((prev) => [...prev, { username, timestamp }]);
            addLog(`AVAILABLE: ${username}`, "accent");
            break;
          case "taken":
            currentTaken++;
            // addLog(`Taken: ${username}`, "info"); // Optionally log taken ones
            break;
          case "throttled":
            setIsThrottled(true);
            // The loop will handle the pause
            break;
          case "error":
             // Error already logged by checkUsernameAvailability
            await delay(5000); // Wait 5s on other errors before retrying
            break;
          case "aborted":
            // Loop will exit
            break;
        }
        setStats({ attempts: currentAttempts, available: currentAvailable, taken: currentTaken });
        
        await delay(1500); // 1.5 second delay between checks
      }
    } catch (error: any) {
       if (error.name !== 'AbortError') {
        addLog(`An unexpected error occurred during hunting: ${error.message}`, "error");
      }
    } finally {
      setIsHunting(false);
      setIsLoading(false);
      if (!signal.aborted) { 
        addLog("Hunt finished or stopped.", "info");
      }
    }
  };

  const handleStartHunting = () => {
    const len = parseInt(usernameLength);
    if (isNaN(len) || len < USER_INPUT_MIN_LENGTH || len > MAX_USERNAME_LENGTH) {
      addLog(`Please enter a valid length between ${USER_INPUT_MIN_LENGTH} and ${MAX_USERNAME_LENGTH}. GitHub min is ${MIN_USERNAME_LENGTH}.`, "error");
      return;
    }

    // Validate character set before starting
    let availableChars = "abcdefghijklmnopqrstuvwxyz";
    if (!excludeNumbers) {
      let numbersToInclude = "0123456789";
      if (specificNumbersToExclude.trim() !== "") {
        const excludedDigits = specificNumbersToExclude
          .split(',')
          .map(d => d.trim())
          .filter(d => d.length === 1 && "0123456789".includes(d));
        excludedDigits.forEach(digit => {
          numbersToInclude = numbersToInclude.replace(new RegExp(digit, 'g'), "");
        });
      }
      availableChars += numbersToInclude;
    }

    if (availableChars.length === 0) {
      addLog("Error: No characters available for username generation. Adjust exclusion settings.", "error");
      return;
    }
    if (len > 0 && availableChars.length < 2 && len > 1) { // Arbitrary threshold for "very small"
         addLog("Warning: The available character set is very small. This may result in many repeated checks or slow progress.", "info");
    }

    huntUsernames(len);
  };

  const handleStopHunting = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsHunting(false);
    setIsLoading(false);
    setIsThrottled(false); 
    addLog("Hunting stopped by user.", "info");
  };

  const handleDownloadUsernames = () => {
    if (availableUsernames.length === 0) {
      addLog("No usernames to download.", "error");
      return;
    }
    const fileContent = availableUsernames
      .map((u) => `${u.timestamp} - [GitHub-Username] Username Available: ${u.username}`)
      .join("\n");
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "available-github-usernames.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    addLog("Usernames file download initiated.", "success");
  };

  const getLogMessageColor = (type: LogMessage["type"]): string => {
    switch (type) {
      case "success": return "text-green-400";
      case "error": return "text-destructive";
      case "accent": return "text-accent";
      case "muted": return "text-muted-foreground";
      case "info":
      default:
        return "text-foreground";
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground font-mono p-4 md:p-8 space-y-6">
      <header className="text-center">
        <h1 className="text-4xl font-bold text-primary">GitHunter</h1>
        <p className="text-muted-foreground">Find available GitHub usernames</p>
      </header>

      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="text-primary">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="usernameLength" className="text-foreground">
              Username Length ({USER_INPUT_MIN_LENGTH}-{MAX_USERNAME_LENGTH})
            </Label>
            <Input
              id="usernameLength"
              type="number"
              min={USER_INPUT_MIN_LENGTH}
              max={MAX_USERNAME_LENGTH}
              value={usernameLength}
              onChange={(e) => setUsernameLength(e.target.value)}
              disabled={isHunting || isLoading}
              className="bg-input border-border text-foreground placeholder-muted-foreground focus:ring-ring"
            />
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="excludeNumbers"
              checked={excludeNumbers}
              onCheckedChange={(checked) => setExcludeNumbers(Boolean(checked))}
              disabled={isHunting || isLoading}
              className="border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground"
            />
            <Label
              htmlFor="excludeNumbers"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-foreground"
            >
              Exclude all numbers
            </Label>
          </div>

          <div>
            <Label htmlFor="specificNumbersToExclude" className="text-foreground">
              Specific numbers to exclude (comma-separated)
            </Label>
            <Input
              id="specificNumbersToExclude"
              type="text"
              value={specificNumbersToExclude}
              onChange={(e) => setSpecificNumbersToExclude(e.target.value.replace(/[^0-9,]/g, ''))}
              disabled={isHunting || isLoading || excludeNumbers}
              className="bg-input border-border text-foreground placeholder-muted-foreground focus:ring-ring"
              placeholder="e.g., 1,3,5"
            />
            {excludeNumbers && (
              <p className="text-xs text-muted-foreground mt-1">Disabled because all numbers are excluded.</p>
            )}
          </div>


          {!isHunting ? (
            <Button onClick={handleStartHunting} disabled={isLoading} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              {isLoading ? "Initializing..." : "Start Hunting"}
            </Button>
          ) : (
            <Button onClick={handleStopHunting} variant="destructive" className="w-full">
              <StopCircle className="mr-2 h-4 w-4" /> Stop Hunting
            </Button>
          )}
          {isHunting && isThrottled && (
             <p className="text-yellow-500 text-sm text-center py-2">
                GitHub API rate limit likely active. Paused, will resume automatically...
             </p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle className="text-primary">Status & Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-around mb-4 text-sm text-foreground">
              <span>Attempts: <span className="text-primary">{stats.attempts}</span></span>
              <span className="text-accent">Available: {stats.available}</span>
              <span>Taken: <span className="text-muted-foreground">{stats.taken}</span></span>
            </div>
            <ScrollArea className="h-64 border border-border rounded-md p-2 bg-card">
              {logMessages.map((msg) => (
                <p key={msg.id} className={`text-sm ${getLogMessageColor(msg.type)} whitespace-pre-wrap break-all`}>
                  <span className="text-muted-foreground mr-1">&gt;</span>{msg.text}
                </p>
              ))}
              <div ref={logEndRef} />
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="shadow-md">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-primary">Available Usernames</CardTitle>
            {availableUsernames.length > 0 && (
              <Button onClick={handleDownloadUsernames} variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">
                <Download className="mr-2 h-4 w-4" /> Download
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-72 border border-border rounded-md p-2 bg-card">
              {availableUsernames.length === 0 && (
                <p className="text-muted-foreground text-center pt-4">No available usernames found yet.</p>
              )}
              {availableUsernames.map((item, index) => (
                <div key={index} className="text-sm p-1.5 flex justify-between items-center border-b border-border/50 last:border-b-0">
                  <span className="text-accent font-medium">{item.username}</span>
                  <span className="text-muted-foreground text-xs">{item.timestamp}</span>
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
       <footer className="text-center text-muted-foreground text-xs pt-4">
        <p>GitHunter - Check GitHub username availability.</p>
        <p>Note: GitHub API has rate limits. Unauthenticated requests are limited to ~60/hour.</p>
        <p>Be patient if throttling occurs; the app will pause and resume.</p>
      </footer>
    </div>
  );
}

    