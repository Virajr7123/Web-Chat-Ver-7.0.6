"use client"

import { useEffect, useState, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Phone, PhoneOff, Video } from "lucide-react"
import { useAuth } from "@/contexts/auth-context"
import { ref, onValue, set, get, off } from "firebase/database"
import { database } from "@/lib/firebase"

interface IncomingCall {
  id: string
  callId?: string
  callerId: string
  callerName: string
  callerAvatar?: string
  type: "voice" | "video"
  timestamp: number
}

interface IncomingCallNotificationProps {
  onAccept: (call: IncomingCall) => void
  onReject: (callId: string) => void
}

export default function IncomingCallNotification({ onAccept, onReject }: IncomingCallNotificationProps) {
  const { currentUser } = useAuth()
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const [isRinging, setIsRinging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const callListenerRef = useRef<any>(null)
  const ringtoneIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Listen for incoming calls
  useEffect(() => {
    if (!currentUser) return

    console.log("Setting up incoming call listener for user:", currentUser.uid)

    const callsRef = ref(database, "calls")

    const handleCallsUpdate = async (snapshot: any) => {
      if (!snapshot.exists()) {
        console.log("No calls in database")
        if (incomingCall) {
          setIncomingCall(null)
          setIsRinging(false)
          setIsProcessing(false)
        }
        return
      }

      const calls = snapshot.val()
      console.log("All calls in database:", calls)

      let foundIncomingCall: IncomingCall | null = null

      // Look for active incoming calls for current user
      for (const [callId, callData] of Object.entries(calls) as [string, any][]) {
        console.log(`Checking call ${callId}:`, callData)

        if (callData.calleeId === currentUser.uid) {
          // Check if this is an active incoming call
          if (callData.status === "calling" && Date.now() - callData.createdAt < 300000) {
            console.log("Found active incoming call:", callId)

            try {
              // Get caller info
              const callerRef = ref(database, `users/${callData.callerId}`)
              const callerSnapshot = await get(callerRef)

              if (callerSnapshot.exists()) {
                const callerData = callerSnapshot.val()
                foundIncomingCall = {
                  id: callId,
                  callId: callId, // Make sure both id and callId are the same
                  callerId: callData.callerId,
                  callerName: callerData.name || callerData.email?.split("@")[0] || "Unknown",
                  callerAvatar: callerData.avatar,
                  type: callData.type,
                  timestamp: callData.createdAt,
                }
                console.log("Created incoming call object:", foundIncomingCall)
                break
              }
            } catch (error) {
              console.error("Error getting caller info:", error)
            }
          }
          // Check if call was ended/rejected by caller
          else if (
            (callData.status === "ended" || callData.status === "rejected") &&
            incomingCall &&
            incomingCall.id === callId
          ) {
            console.log("Call was ended/rejected by caller, clearing notification")
            setIncomingCall(null)
            setIsRinging(false)
            setIsProcessing(false)
            return
          }
        }
      }

      // Update state
      if (foundIncomingCall) {
        if (!incomingCall || incomingCall.id !== foundIncomingCall.id) {
          console.log("Setting new incoming call with ID:", foundIncomingCall.id)
          setIncomingCall(foundIncomingCall)
          setIsRinging(true)
          setIsProcessing(false)
        }
      } else if (incomingCall && !isProcessing) {
        console.log("Clearing incoming call - no active calls found")
        setIncomingCall(null)
        setIsRinging(false)
        setIsProcessing(false)
      }
    }

    callListenerRef.current = callsRef
    onValue(callsRef, handleCallsUpdate)

    return () => {
      console.log("Cleaning up incoming call listener")
      if (callListenerRef.current) {
        off(callListenerRef.current)
      }
      stopRingtone()
    }
  }, [currentUser])

  // Ringtone functions
  const startRingtone = () => {
    if (ringtoneIntervalRef.current) return

    console.log("Starting ringtone")

    const playRingtone = () => {
      try {
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
        }

        const audioContext = audioContextRef.current
        const oscillator = audioContext.createOscillator()
        const gainNode = audioContext.createGain()

        oscillator.connect(gainNode)
        gainNode.connect(audioContext.destination)

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime)
        oscillator.frequency.setValueAtTime(600, audioContext.currentTime + 0.5)

        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1)

        oscillator.start(audioContext.currentTime)
        oscillator.stop(audioContext.currentTime + 1)
      } catch (error) {
        console.error("Error playing ringtone:", error)
      }
    }

    playRingtone()
    ringtoneIntervalRef.current = setInterval(playRingtone, 2000)
  }

  const stopRingtone = () => {
    console.log("Stopping ringtone")
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current)
      ringtoneIntervalRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }

  // Start/stop ringtone based on ringing state
  useEffect(() => {
    if (isRinging && !isProcessing) {
      startRingtone()
    } else {
      stopRingtone()
    }

    return () => {
      stopRingtone()
    }
  }, [isRinging, isProcessing])

  const handleAccept = async () => {
    if (!incomingCall || isProcessing) return

    console.log("SMALL NOTIFICATION: Accepting call with ID:", incomingCall.id)
    setIsProcessing(true)
    stopRingtone()

    try {
      // DON'T change the call status here - let the big interface handle it
      // Just pass the call info to the parent
      console.log("SMALL NOTIFICATION: Passing call to parent with ID:", incomingCall.id)

      // Call the onAccept callback with the EXACT same call object
      onAccept({
        ...incomingCall,
        callId: incomingCall.id, // Ensure callId matches id
      })

      // Clear the notification immediately
      setIncomingCall(null)
      setIsRinging(false)
      setIsProcessing(false)
    } catch (error) {
      console.error("Error accepting call:", error)
      setIsProcessing(false)
      setIsRinging(true)
    }
  }

  const handleReject = async () => {
    if (!incomingCall || isProcessing) return

    console.log("REJECTING CALL:", incomingCall.id)
    setIsProcessing(true)
    stopRingtone()

    try {
      // Set call status to rejected
      const callRef = ref(database, `calls/${incomingCall.id}/status`)
      await set(callRef, "rejected")
      console.log("Call status set to rejected")

      // Call the onReject callback
      onReject(incomingCall.id)

      // Clear the notification immediately for reject
      setIncomingCall(null)
      setIsRinging(false)
      setIsProcessing(false)
    } catch (error) {
      console.error("Error rejecting call:", error)
      setIsProcessing(false)
    }
  }

  // Don't render if no incoming call
  if (!incomingCall) return null

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[10000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-8 text-white text-center max-w-sm w-full shadow-2xl border border-white/10"
          initial={{ scale: 0.8, y: 50 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.8, y: 50 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {/* Caller Avatar */}
          <motion.div
            className="relative mx-auto mb-6"
            animate={{
              scale: [1, 1.05, 1],
            }}
            transition={{
              duration: 2,
              repeat: Number.POSITIVE_INFINITY,
              ease: "easeInOut",
            }}
          >
            <Avatar className="h-24 w-24 mx-auto border-4 border-white/20 shadow-xl">
              <AvatarImage src={incomingCall.callerAvatar || "/placeholder.svg?height=96&width=96"} />
              <AvatarFallback className="bg-gradient-to-br from-purple-500 to-blue-500 text-white text-xl">
                {incomingCall.callerName.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>

            {/* Pulse Animation */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-white/30"
              animate={{
                scale: [1, 1.5, 2],
                opacity: [0.8, 0.3, 0],
              }}
              transition={{
                duration: 2,
                repeat: Number.POSITIVE_INFINITY,
                ease: "easeOut",
              }}
            />
          </motion.div>

          {/* Caller Name */}
          <h3 className="text-2xl font-bold mb-2">{incomingCall.callerName}</h3>

          {/* Call Type */}
          <div className="flex items-center justify-center space-x-2 mb-6">
            {incomingCall.type === "video" ? (
              <Video className="h-5 w-5 text-blue-400" />
            ) : (
              <Phone className="h-5 w-5 text-green-400" />
            )}
            <span className="text-white/80">Incoming {incomingCall.type} call</span>
          </div>

          {/* Processing State */}
          {isProcessing && (
            <div className="mb-4">
              <motion.div
                className="w-6 h-6 border-2 border-white border-t-transparent rounded-full mx-auto"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              />
              <p className="text-sm text-white/60 mt-2">Connecting...</p>
            </div>
          )}

          {/* Action Buttons */}
          {!isProcessing && (
            <div className="flex justify-center space-x-8">
              {/* Reject Button */}
              <motion.button
                className="p-4 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg"
                onClick={handleReject}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                animate={{
                  boxShadow: [
                    "0 0 0 0 rgba(239, 68, 68, 0.7)",
                    "0 0 0 10px rgba(239, 68, 68, 0)",
                    "0 0 0 0 rgba(239, 68, 68, 0)",
                  ],
                }}
                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
              >
                <PhoneOff className="h-6 w-6" />
              </motion.button>

              {/* Accept Button */}
              <motion.button
                className="p-4 rounded-full bg-green-500 hover:bg-green-600 text-white shadow-lg"
                onClick={handleAccept}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                animate={{
                  boxShadow: [
                    "0 0 0 0 rgba(34, 197, 94, 0.7)",
                    "0 0 0 10px rgba(34, 197, 94, 0)",
                    "0 0 0 0 rgba(34, 197, 94, 0)",
                  ],
                }}
                transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
              >
                <Phone className="h-6 w-6" />
              </motion.button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
