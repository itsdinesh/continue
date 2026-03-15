import React, { useEffect } from "react";
import { HoverDiv, HoverTextDiv } from "./StyledComponents";

interface DragOverlayProps {
  show: boolean;
  setShow: (show: boolean) => void;
  message?: string;
}

export const DragOverlay: React.FC<DragOverlayProps> = ({
  show,
  setShow,
  message,
}) => {
  useEffect(() => {
    const overListener = (event: DragEvent) => {
      if (event.shiftKey) return;
      setShow(true);
    };
    window.addEventListener("dragover", overListener);

    const leaveListener = (event: DragEvent) => {
      if (event.shiftKey) {
        setShow(false);
      } else {
        setTimeout(() => setShow(false), 2000);
      }
    };
    window.addEventListener("dragleave", leaveListener);

    return () => {
      window.removeEventListener("dragover", overListener);
      window.removeEventListener("dragleave", leaveListener);
    };
  }, []);

  if (!show) return null;

  return (
    <>
      <HoverDiv />
      <HoverTextDiv>{message ?? "Hold ⇧ to drop image"}</HoverTextDiv>
    </>
  );
};
