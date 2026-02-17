"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface TypewriterEffectProps {
  words: string[];
  staticText?: string;
  className?: string;
  cursorClassName?: string;
}

export const TypewriterEffect = ({
  words,
  staticText = "",
  className,
  cursorClassName,
}: TypewriterEffectProps) => {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentText, setCurrentText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const word = words[currentWordIndex];
    
    const typeSpeed = isDeleting ? 50 : 100;
    const deleteSpeed = 30;
    const pauseTime = 2000;

    const handleType = () => {
      if (!isDeleting) {
        if (currentText.length < word.length) {
          setCurrentText(word.slice(0, currentText.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), pauseTime);
        }
      } else {
        if (currentText.length > 0) {
          setCurrentText(word.slice(0, currentText.length - 1));
        } else {
          setIsDeleting(false);
          setCurrentWordIndex((prev) => (prev + 1) % words.length);
        }
      }
    };

    const timer = setTimeout(handleType, isDeleting ? deleteSpeed : typeSpeed);

    return () => clearTimeout(timer);
  }, [currentText, isDeleting, currentWordIndex, words]);

  return (
    <div className={cn("flex items-center", className)}>
      <span className="mr-1">{staticText}</span>
      <span className="font-bold">{currentText}</span>
      <span
        className={cn(
          "ml-1 block h-4 w-[2px] animate-pulse bg-primary",
          cursorClassName
        )}
      />
    </div>
  );
};
