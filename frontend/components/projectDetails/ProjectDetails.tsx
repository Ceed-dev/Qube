import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/router";
import { FileWithPath } from "react-dropzone";

// Interface Imports
import {
  DisplayFileDeliverableInterface,
  DisplayProjectDetailsInterface,
  DisplayTextDeliverableInterface,
  SectionWrapperPropsInterface,
  StoreFileDeliverableInterface,
  StoreProjectDetailsInterface,
} from "../../interfaces";

// Framer-Motion Imports
import { motion } from "framer-motion";

// Custom Component Imports
import {
  CustomButton,
  Glow,
  ProjectDetailsDescription,
  Dropbox,
  SubmitTextArea,
} from "../index";

// Constant Imports
import { aesthetics, signProjectEip712 } from "../../constants";

// Wagmi Imports
import { useAccount, useSignTypedData } from "wagmi";

// Rainbowkit Imports
import { useConnectModal } from "@rainbow-me/rainbowkit";

// Context Imports
import { useNotificationContext } from "../../context";

// utils Imports
import { getDataFromFireStore, activeUserByStatus, updateProjectDetails, storage } from "../../utils";
import { populateStates } from "../../utils/projectDetail";
import { IconNotificationError, IconCopy, IconNotificationSuccess } from "../../assets";
import { StatusEnum } from "../../enums";
import { ref, getDownloadURL, uploadBytesResumable } from "firebase/storage";

import Modal from "./Modal";

const SectionWrapper: React.FC<SectionWrapperPropsInterface> = ({
  children,
  bgColor,
  glowStyles,
}): JSX.Element => {
  return (
    <motion.div
      className={`w-full grid grid-cols-12 ${bgColor} xl:py-40 lg:py-32 py-28 overflow-hidden relative min-h-screen font-nunito`}
    >
      {glowStyles && <Glow styles={glowStyles} />}
      <div className="col-start-2 lg:col-end-10 col-end-12 font-semibold relative flex flex-col justify-center">
        {children}
      </div>
    </motion.div>
  );
};

const ProjectDetails = ({ projectId }: { projectId: string }): JSX.Element => {
  // Notification Context
  const context = useNotificationContext();
  const setShowNotification = context.setShowNotification;
  const setNotificationConfiguration = context.setNotificationConfiguration;

  // States
  const [section, setSection] = useState("description");
  const [projectDetails, setProjectDetails] = useState(
    {} as DisplayProjectDetailsInterface
  );
  const [isAssigned, setIsAssigned] = useState(false);
  const [fileDeliverables, setFileDeliverables] =
    useState<DisplayFileDeliverableInterface[]>([]);
  const [textDeliverables, setTextDeliverables] =
    useState<DisplayTextDeliverableInterface[]>([]);

  // Wagmi
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signTypedDataAsync } = useSignTypedData({
    domain: signProjectEip712.domain,
    types: signProjectEip712.types,
    value: {
      "Title": projectDetails.Title,
      "Detail": projectDetails.Detail,
      "Deadline(UTC)": projectDetails["Deadline(UTC)"],
      "Reward(USDC)": projectDetails["Reward(USDC)"],
      "Client's Wallet Address": projectDetails["Client's Wallet Address"],
      "Freelancer's Wallet Address": address,
    },
  });

  useEffect(() => {
    if (projectId) {
      populateStates(
        projectId,
        setIsAssigned,
        setProjectDetails,
        setFileDeliverables,
        setNotificationConfiguration,
        setShowNotification,
        setTextDeliverables
      );
    }
  }, [projectId]);

  const router = useRouter();

  async function handleCopyToClipboard() {
    try {
      const textToCopy = `http://${window.location.host}/${router.asPath}`;
      await navigator.clipboard.writeText(textToCopy);
      setNotificationConfiguration({
        modalColor: "#62d140",
        title: "Copy the link",
        message: "Successfully copied the link to the clipboard",
        icon: IconNotificationSuccess,
      });

      setShowNotification(true);
    } catch (error) {}
  };

  const [showModal, setShowModal]: [
    showModal: boolean,
    setShowModal: React.Dispatch<React.SetStateAction<boolean>>
  ] = useState(false);
  const title = "Submit The Deliverables";
  const description = "Are your deliverables appropriate? If it's not appropriate then you may not get the rewards. If you are sure press the \"Comfirm\" button.";

  const [files, setFiles] = useState([]);

  const [isDropable, setIsDropable] = useState(true);

  const displayFiles = [
    ...fileDeliverables.map(fileDeliverable => ({ 
      name: fileDeliverable.fileName, 
      size: fileDeliverable.fileSize, 
      state: "uploaded", 
      downloadUrl: fileDeliverable.downloadUrl,
      progress: fileDeliverable.progress,
    })),
    ...files.map(file => ({ 
      name: file.name, 
      size: file.size, 
      state: "waiting",
      downloadUrl: "",
      progress: "", 
    })),
  ];

  const uploadFile = async (acceptedFiles: FileWithPath[]) => {
    if (!isAssigned) {
      setFiles([]);
      throw new Error("Not Approved for the project");
    }

    if (!isDropable) {
      return;
    }

    // Update the status to "Waiting for Payment"
    if (projectDetails.fileDeliverable === undefined && projectDetails.textDeliverable === undefined) {
      const updatedSubsetProjectDetail: Partial<StoreProjectDetailsInterface> =
        {
          "Status": StatusEnum.WaitingForPayment,
        };
      await updateProjectDetails(projectId, updatedSubsetProjectDetail);
      const [_, updatedProjectDetails] = await getDataFromFireStore(
        projectId
      );
      setProjectDetails(updatedProjectDetails);
    }

    setIsDropable(false);

    let updatedFileDeliverables: StoreFileDeliverableInterface[] =
      fileDeliverables.map((fileDeliverable) => {
        return {
          fileName: fileDeliverable.fileName,
          fileSize: fileDeliverable.fileSize,
          downloadUrl: fileDeliverable.downloadUrl,
        };
      });

    const uploadPromises: Promise<StoreFileDeliverableInterface>[] =
      acceptedFiles.map((file, acceptedFileIndex) => {
        const index = fileDeliverables.length + acceptedFileIndex;
        // const index = acceptedFileIndex;
        const storageRef = ref(storage, `${projectId}/${file.name}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        setFiles(prevFiles => prevFiles.filter(f => f !== file));

        return new Promise((resolve, reject) => {
          ((index: number) => {
            uploadTask.on(
              "state_changed",
              (snapshot) => {
                const progress =
                  (snapshot.bytesTransferred / snapshot.totalBytes) * 100;

                setFileDeliverables((prevFileDeliverableArray) => {
                  const updatedFileDeliverableArray = [
                    ...prevFileDeliverableArray,
                  ];

                  updatedFileDeliverableArray[index] = {
                    fileName: file.name,
                    fileSize: `${file.size}`,
                    progress: `${progress}`,
                    downloadUrl: undefined as string,
                  };

                  return updatedFileDeliverableArray;
                });
              },
              (error) => {
                reject(undefined as StoreFileDeliverableInterface);
              },
              () => {
                getDownloadURL(uploadTask.snapshot.ref).then(
                  (downloadUrl) => {
                    setFileDeliverables((prevFileDeliverableArray) => {
                      const updatedFileDeliverableArray = [
                        ...prevFileDeliverableArray,
                      ];
                      updatedFileDeliverableArray[index] = {
                        ...updatedFileDeliverableArray[index],
                        downloadUrl: downloadUrl,
                      };

                      resolve({
                        fileName: file.name,
                        fileSize: `${file.size}`,
                        downloadUrl: downloadUrl,
                      } as StoreFileDeliverableInterface);

                      return updatedFileDeliverableArray;
                    });
                  }
                );
              }
            );
          })(index);
        });
      });

    const resolvedUploadPromises = await Promise.all(uploadPromises);

    updatedFileDeliverables = [
      ...updatedFileDeliverables,
      ...resolvedUploadPromises,
    ];

    await updateProjectDetails(projectId, {
      fileDeliverable: updatedFileDeliverables,
    });

    await populateStates(
      projectId,
      setIsAssigned,
      setProjectDetails,
      setFileDeliverables,
      setNotificationConfiguration,
      setShowNotification,
      setTextDeliverables
    );
    setIsDropable(true);
  };

  const [text, setText] = useState<string>("");

  const uploadText = async (text: string) => {
    if (text) {
      if (!isAssigned) {
        setText("");
        throw new Error("Not Approved for the project");
      }

      // Update the status to "Waiting for Payment"
      if (projectDetails.fileDeliverable === undefined && projectDetails.textDeliverable === undefined) {
        const updatedSubsetProjectDetail: Partial<StoreProjectDetailsInterface> =
          {
            "Status": StatusEnum.WaitingForPayment,
          };
        await updateProjectDetails(projectId, updatedSubsetProjectDetail);
        const [_, updatedProjectDetails] = await getDataFromFireStore(
          projectId
        );
        setProjectDetails(updatedProjectDetails);
      }

      const prevTextDeliverableStorage = textDeliverables.map(
        (textDeliverable) => textDeliverable.text
      );
      const updatedTextDeliverables = [...prevTextDeliverableStorage, text];
      await updateProjectDetails(projectId, {
        textDeliverable: updatedTextDeliverables,
      });
      await populateStates(
        projectId,
        setIsAssigned,
        setProjectDetails,
        setFileDeliverables,
        setNotificationConfiguration,
        setShowNotification,
        setTextDeliverables
      );

      setText("");
    }
  };

  return (
    <SectionWrapper
      bgColor="bg-bg_primary"
      glowStyles={aesthetics.glow.createProjectGlowStyles}
    >
      {/* Return to Dashboard Button */}
      <button className="bg-orange-500 mb-7 mr-auto p-3 text-xl rounded-full text-white" onClick={() => {
          router.push(`http://${window.location.host}/dashboard/${address}`);
        }}>{`<- Return to Dashboard`}</button>
      <div className="w-full lg:p-[3px] p-[2px] rounded-lg blue-transparent-green-gradient-vertical">
        <div className="w-full h-full rounded-lg bg-black">
          <div className="w-full xl:px-8 xl:py-12 px-6 sm:py-10 py-6 text-[#959595]">
            {/* Header */}
            <div className="w-full text-white">
              {section === "description" && (
                <h1 className="flex flex-row items-center gap-5 sm:text-4xl xs:text-3xl text-3xl">
                  <Image
                    src={IconCopy}
                    alt="copy"
                    className="h-6 w-auto cursor-pointer"
                    onClick={() => handleCopyToClipboard()}
                  />
                  Project for {projectDetails.Title}
                  {/* TODO: fix this, change this button to a block */}
                  {projectDetails.Status !== StatusEnum.CompleteNoSubmissionByLancer
                  && projectDetails.Status !== StatusEnum.CompleteNoContactByClient
                  && projectDetails.Status !== StatusEnum.CompleteApproval
                  && projectDetails.Status !== StatusEnum.CompleteDisapproval
                  && projectDetails.Status !== StatusEnum.CompleteDispute
                  && projectDetails.Status !== StatusEnum.InDispute
                  && projectDetails.Status !== StatusEnum.Cancel
                  &&
                    <button
                      onClick={() => {}}
                      className="bg-green-500 text-white font-bold py-2 px-4 rounded ml-auto"
                    >
                      {activeUserByStatus(projectDetails)}
                    </button>
                  }
                </h1>
              )}

              {section === "submission" && (
                <h1 className="sm:text-4xl xs:text-3xl text-3xl">
                  Submission
                </h1>
              )}

              {/* Detail Sections */}
              <div className="flex flex-row xs:justify-start justify-between sm:gap-8 xs:gap-4 gap-0 xs:mt-6 mt-6">
                <CustomButton
                  text="Description"
                  styles={`${
                    section === "description" ? "bg-[#3E8ECC]" : ""
                  } rounded-md text-center xs:text-base text-sm text-white py-[2px] px-4 hover:bg-[#377eb5]`}
                  onClick={() => {
                    setSection("description");
                  }}
                  type={"button"}
                />
                {projectDetails.Status !== StatusEnum.CompleteNoSubmissionByLancer
                && projectDetails.Status !== StatusEnum.PayInAdvance && (
                  <CustomButton
                    text="Submission"
                    styles={`${
                      section === "submission" ? "bg-[#3E8ECC]" : ""
                    } rounded-md text-center xs:text-base text-sm text-white py-[2px] px-4 hover:bg-[#377eb5]`}
                    onClick={() => {
                      setSection("submission");
                    }}
                    type={"button"}
                  />
                )}
              </div>
              {/* Separator Line */}
              <div className="w-full py-[0.6px] mt-4 bg-[#1E1E1E]"></div>
            </div>
            {/* Main */}
            {section === "description" && (
              <ProjectDetailsDescription
                isAssigned={isAssigned}
                openConnectModal={openConnectModal}
                signTypedDataAsync={signTypedDataAsync}
                // nftOwnerAddress={address}
                freelancerAddress={address}
                setFileDeliverables={setFileDeliverables}
                projectId={projectId}
                setIsAssigned={setIsAssigned}
                setProjectDetails={setProjectDetails}
                setNotificationConfiguration={setNotificationConfiguration}
                setShowNotification={setShowNotification}
                projectDetails={projectDetails}
                setTextDeliverables={setTextDeliverables}
              />
            )}
            {section === "submission" && (
              <div className="w-full md:w-[95%] lg:w-[90%] xl:w-[85%] mx-auto">
                <Dropbox
                  setFiles={setFiles}
                  displayFiles={displayFiles}
                  isDropable={isDropable}
                />
                <SubmitTextArea
                  textDeliverables={textDeliverables}
                  setTextDeliverables={setTextDeliverables}
                  text={text}
                  setText={setText}
                />
                <CustomButton
                  text={title}
                  styles={`w-full md:w-[90%] lg:w-[80%] mx-auto block ${
                    (text !== "" || files.length > 0)
                    ? "bg-[#3E8ECC] hover:bg-[#377eb5]"
                    : "bg-slate-400"
                  } rounded-md text-center text-lg font-semibold text-white py-[4px] px-7 mt-6`}
                  type="submit"
                  onClick={(e) => {
                    e.preventDefault();
                    if (text !== "" || files.length > 0) {
                      setShowModal(true);
                    }
                  }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <Modal
        showModal={showModal}
        setShowModal={setShowModal}
        title={title}
        description={description}
        onConfirm={() => 
          Promise.all([uploadFile(files), uploadText(text)])
            .then(() => {
              console.log("Successfully uploaded");
              setNotificationConfiguration({
                modalColor: "#62d140",
                title: "Successfully submitted the deliverables",
                message: "Well done! Wait till your submissions get approved by the client.",
                icon: IconNotificationSuccess,
              });
            })
            .catch((error) => {
              console.log(error);
              if (error.message === "Not Approved for the project") {
                setNotificationConfiguration({
                  modalColor: "#d14040",
                  title: "Not Approved",
                  message: "Adddress not Approved for project",
                  icon: IconNotificationError,
                });
              } else {
                setNotificationConfiguration({
                  modalColor: "#d14040",
                  title: "Error",
                  message: "Error submitting the files",
                  icon: IconNotificationError,
                });
              }
            })
            .finally(() => setShowNotification(true))
        }
      />
    </SectionWrapper>
  );
};

export default ProjectDetails;
